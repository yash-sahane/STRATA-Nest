import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { RealtimeFrame } from '@strata/shared';
import { PrismaService, type WriteAction } from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { MODEL_COLLECTION, USER_SCOPED_COLLECTIONS } from './realtime.constants';
import { SocketRegistry, type SocketInfo } from './socket-registry';

const REDIS_CHANNEL = 'realtime:broadcast';
const nowIso = (): string => new Date().toISOString();

interface BroadcastMessage {
  frame: RealtimeFrame;
  workspaceId?: string;
  origin: string;
}

/**
 * Delivers resource/domain events to authorized WebSocket rooms.
 * - CRUD events come from the Prisma write hook, which fires after every persisted change.
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
        if (msg.origin !== this.instanceId) this.broadcastLocal(msg.frame, msg.workspaceId);
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
    const row = (result ?? {}) as { id?: string; workspaceId?: string; userId?: string };
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
    if (unfilterable && USER_SCOPED_COLLECTIONS.has(collection) && row.userId !== undefined) {
      minimal.userId = row.userId;
    }
    const frame: RealtimeFrame = {
      event: `${collection}.${action}`,
      // Minimal/best-effort payload (frontend refetches on the channel).
      payload: action === 'delete' || unfilterable ? minimal : row,
      channels: [collection, `${collection}.${row.id}`],
      timestamp: nowIso(),
    };
    this.emit(frame, row.workspaceId);
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
  emit(frame: RealtimeFrame, workspaceId?: string): void {
    this.broadcastLocal(frame, workspaceId);
    const msg: BroadcastMessage = { frame, workspaceId, origin: this.instanceId };
    this.redis.publish(REDIS_CHANNEL, JSON.stringify(msg)).catch(() => undefined);
  }

  private broadcastLocal(frame: RealtimeFrame, workspaceId?: string): void {
    const data = JSON.stringify(frame);
    for (const [socket, info] of this.registry.entries()) {
      if (!RealtimeService.canReceive(info, workspaceId)) continue;
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
    if (workspaceId === undefined) return true; // unscoped resource (comments/kanban) — broadcasts to every connected socket
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
