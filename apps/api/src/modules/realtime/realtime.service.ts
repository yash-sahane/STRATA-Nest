import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { RealtimeFrame } from '@strata/shared';
import { PrismaService, type WriteAction } from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  FULL_ROW_COLLECTIONS,
  MODEL_COLLECTION,
  PROJECT_SCOPED_COLLECTIONS,
  USER_SCOPED_COLLECTIONS,
  WORKSPACE_VIA,
} from './realtime.constants';
import { SocketRegistry, type SocketInfo } from './socket-registry';

const REDIS_CHANNEL = 'realtime:broadcast';
const nowIso = (): string => new Date().toISOString();

/** The fields of a written row the broadcast routes on. */
interface WrittenRow {
  id?: string;
  workspaceId?: string;
  projectId?: string;
  userId?: string;
  status?: string;
}

/** A change to who belongs to a workspace, applied to the socket registry of
 *  every instance alongside the frame that announces it. */
interface MembershipChange {
  userId: string;
  workspaceId: string;
  active: boolean;
}

interface BroadcastMessage {
  /** Absent on a control message (`disconnectUserId`). */
  frame?: RealtimeFrame;
  workspaceId?: string;
  membership?: MembershipChange;
  /** Close this user's sockets on every instance. */
  disconnectUserId?: string;
  origin: string;
}

/**
 * Delivers resource/domain events to authorized WebSocket rooms.
 * - CRUD events come from the Prisma write hook, which fires once a change is
 *   committed (a transaction's writes wait for its commit — see WriteAnnouncer).
 * - broadcastLocal filters every socket by workspace membership, so subscribing
 *   to a collection channel never leaks other workspaces' data.
 * - Cross-instance fan-out via Redis pub/sub.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly instanceId = randomUUID();
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly registry: SocketRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // 1. Central CRUD events: register the Prisma write hook.
    this.prisma.setWriteHook((model, action, result) => this.onWrite(model, action, result));

    // 2. Cross-instance fan-out: subscribe to the Redis broadcast channel.
    this.subscriber = this.redis.duplicate();
    this.subscriber
      .subscribe(REDIS_CHANNEL)
      .catch((e: Error) => this.logger.warn(`realtime redis subscribe failed: ${e.message}`));
    this.subscriber.on('message', (_channel, raw) => {
      try {
        const msg = JSON.parse(raw) as BroadcastMessage;
        if (msg.origin !== this.instanceId) this.deliver(msg);
      } catch {
        /* ignore malformed */
      }
    });
  }

  /**
   * RC finding: the duplicated Redis subscriber was never closed on shutdown,
   * so `app.close()` (SIGTERM) never actually terminated the process — it kept
   * reconnecting/holding the event loop open (live-verified via a hanging e2e
   * teardown). Close it here so graceful shutdown is actually graceful.
   */
  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Post-write CRUD event → `<collection>.<create|update|delete>` frame. */
  private onWrite(model: string, action: WriteAction, result: unknown): void {
    const collection = MODEL_COLLECTION[model];
    if (!collection) return;
    const row = (result ?? {}) as WrittenRow;
    if (!row.id) return;
    const via = WORKSPACE_VIA[model];
    if (via && row.workspaceId === undefined) {
      // Look the workspace up, then announce: late by one query, never to the
      // wrong people. A row whose parent is already gone (a cascade) is dropped
      // — whoever deleted the parent announced that.
      void this.workspaceOf(via, row as Record<string, unknown>)
        .then((workspaceId) => {
          if (workspaceId) this.announce(model, collection, action, { ...row, workspaceId });
        })
        .catch((e: Error) => this.logger.warn(`realtime: ${model} not announced: ${e.message}`));
      return;
    }
    this.announce(model, collection, action, row);
  }

  private async workspaceOf(
    via: { parent: 'task' | 'project' | 'self'; key: string },
    row: Record<string, unknown>,
  ): Promise<string | undefined> {
    const id = typeof row[via.key] === 'string' ? (row[via.key] as string) : '';
    if (!id) return undefined;
    if (via.parent === 'self') return id;
    const parent =
      via.parent === 'task'
        ? await this.prisma.task.findUnique({ where: { id }, select: { workspaceId: true } })
        : await this.prisma.project.findUnique({ where: { id }, select: { workspaceId: true } });
    return parent?.workspaceId || undefined;
  }

  private announce(model: string, collection: string, action: WriteAction, row: WrittenRow): void {
    if (!row.id) return;

    /**
     * Rows with no `workspaceId` cannot be filtered by membership.
     *
     * `canReceive` treats an undefined workspace as "unscoped" and lets the
     * frame reach EVERY connected socket — which for task_comments meant the
     * full row, comment text included, was delivered to people with no
     * membership of that workspace at all. The channel only needs to say that
     * something changed: strip the payload to the id (plus the recipient id for
     * user-scoped collections, which `isAddressedTo` needs to route on) and let
     * the client refetch through the REST route, which does check membership.
     */
    const unfilterable = row.workspaceId === undefined;
    const minimal: Record<string, unknown> = { id: String(row.id) };
    // Where the record lives, so a client refetches only the lists it can have
    // changed (PROJECT_SCOPED_COLLECTIONS). The frame reaches members of this
    // workspace alone, and each of them can list its projects: naming the
    // workspace and the project tells a receiver nothing it could not read.
    if (typeof row.workspaceId === 'string' && row.workspaceId) {
      minimal.workspaceId = row.workspaceId;
    }
    const projectId =
      collection === 'projects'
        ? row.id
        : PROJECT_SCOPED_COLLECTIONS.has(collection)
          ? row.projectId
          : undefined;
    if (typeof projectId === 'string' && projectId) minimal.projectId = projectId;
    // The recipient travels with every user-scoped frame, the delete included:
    // without it `isAddressedTo` fails closed, so a notification deleted in one
    // tab stayed in every other tab of the same person.
    if (USER_SCOPED_COLLECTIONS.has(collection) && row.userId !== undefined) {
      minimal.userId = row.userId;
    }
    // The row itself only for the collections that are allowed it — see
    // FULL_ROW_COLLECTIONS for why that is the exception. A delete never needs it.
    const withRow = action !== 'delete' && !unfilterable && FULL_ROW_COLLECTIONS.has(collection);
    const frame: RealtimeFrame = {
      event: `${collection}.${action}`,
      // Everything else is "this changed, refetch" — the REST read decides what
      // the receiver may see.
      payload: withRow ? row : minimal,
      channels: [collection, `${collection}.${row.id}`],
      timestamp: nowIso(),
    };
    this.emit(frame, row.workspaceId, RealtimeService.membershipChange(model, action, row));
  }

  /** A write to a membership row decides who may receive this workspace's frames
   *  from here on. ACTIVE only, the same rule `accessibleWorkspaceIds` applies
   *  when a socket connects. */
  private static membershipChange(
    model: string,
    action: WriteAction,
    row: { workspaceId?: string; userId?: string; status?: string },
  ): MembershipChange | undefined {
    if (model !== 'WorkspaceMember' || !row.workspaceId || !row.userId) return undefined;
    return {
      userId: row.userId,
      workspaceId: row.workspaceId,
      active: action !== 'delete' && row.status === 'ACTIVE',
    };
  }

  /** Bridge a business domain event onto a collection channel (RealtimeSubscriber). */
  emitEvent(
    collection: string,
    event: string,
    entityId: string,
    workspaceId: string,
    payload: Record<string, unknown>,
  ): void {
    this.emit(
      { event, payload, channels: [collection, `${collection}.${entityId}`], timestamp: nowIso() },
      workspaceId,
    );
  }

  /** Broadcast locally + publish to Redis for other instances. */
  emit(frame: RealtimeFrame, workspaceId?: string, membership?: MembershipChange): void {
    this.send({ frame, workspaceId, membership, origin: this.instanceId });
  }

  /** End a user's live connections everywhere — their sessions were revoked. */
  disconnectUser(userId: string): void {
    this.send({ disconnectUserId: userId, origin: this.instanceId });
  }

  private send(msg: BroadcastMessage): void {
    this.deliver(msg);
    this.redis.publish(REDIS_CHANNEL, JSON.stringify(msg)).catch(() => undefined);
  }

  /**
   * Deliver one message on this instance. Access is granted BEFORE the frame goes
   * out and revoked AFTER it, so the member the change is about still receives
   * the frame announcing it — and nothing from that workspace afterwards.
   */
  private deliver(msg: BroadcastMessage): void {
    if (msg.disconnectUserId) {
      this.registry.closeUser(msg.disconnectUserId);
      return;
    }
    if (!msg.frame) return;
    const { membership } = msg;
    if (membership?.active) {
      this.registry.setMembership(membership.userId, membership.workspaceId, true);
    }
    this.broadcastLocal(msg.frame, msg.workspaceId);
    if (membership && !membership.active) {
      this.registry.setMembership(membership.userId, membership.workspaceId, false);
    }
  }

  private broadcastLocal(frame: RealtimeFrame, workspaceId?: string): void {
    const data = JSON.stringify(frame);
    // A user-scoped row is its recipient's whether or not they still belong to
    // the workspace it was filed under — the notice that says they were removed
    // is filed under the workspace they lost. REST answers them by recipient
    // alone, and so does this.
    const addressed = USER_SCOPED_COLLECTIONS.has(frame.channels[0]);
    for (const [socket, info] of this.registry.entries()) {
      if (!addressed && !RealtimeService.canReceive(info, workspaceId)) continue;
      if (!RealtimeService.isAddressedTo(info, frame)) continue;
      if (!frame.channels.some((c) => info.channels.has(c))) continue;
      try {
        socket.send(data);
      } catch {
        /* dead socket; cleaned up on close */
      }
    }
  }

  /** Workspace-membership authorization for a broadcast. */
  static canReceive(info: Pick<SocketInfo, 'workspaceIds'>, workspaceId?: string): boolean {
    if (workspaceId === undefined) return true; // nothing left that is unscoped: see WORKSPACE_VIA
    if (info.workspaceIds === null) return true; // platform admin
    return info.workspaceIds.has(workspaceId);
  }

  /**
   * Row-owner authorization for the USER_SCOPED_COLLECTIONS. Workspace
   * membership authorizes the workspace, not another member's private row, so a
   * notification frame reaches only the socket of the user it is addressed to
   * (previously every member of the workspace received it and the recipient
   * check happened in the browser, i.e. nowhere). Fails closed: a frame with no
   * recipient on the wire (a delete carries only `{id}`) is not delivered.
   */
  static isAddressedTo(info: Pick<SocketInfo, 'user'>, frame: RealtimeFrame): boolean {
    if (!USER_SCOPED_COLLECTIONS.has(frame.channels[0])) return true;
    const { userId } = frame.payload as { userId?: unknown };
    return typeof userId === 'string' && userId === info.user.id;
  }
}
