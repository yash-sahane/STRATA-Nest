import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { RealtimeFrame } from '@lt/shared';
import { PrismaService, type WriteAction } from '@lt/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { MODEL_COLLECTION } from './realtime.constants';
import { SocketRegistry, type SocketInfo } from './socket-registry';

const REDIS_CHANNEL = 'realtime:broadcast';
const nowIso = (): string => new Date().toISOString();

interface BroadcastMessage {
  frame: RealtimeFrame;
  workspaceId?: string;
  origin: string;
}

/**
 * Delivers resource/domain events to authorized WebSocket rooms (ADR-0006).
 * - CRUD events come from the Prisma write hook (replaces the Django signal, A§7).
 * - The **D2 fix**: broadcastLocal filters every socket by workspace membership,
 *   so subscribing to a collection channel never leaks other workspaces' data.
 * - Cross-instance fan-out via Redis pub/sub (replaces channels-redis).
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
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

  /** Post-write CRUD event → `<collection>.<create|update|delete>` frame. */
  private onWrite(model: string, action: WriteAction, result: unknown): void {
    const collection = MODEL_COLLECTION[model];
    if (!collection) return;
    const row = (result ?? {}) as { id?: string; workspaceId?: string };
    if (!row.id) return;
    const frame: RealtimeFrame = {
      event: `${collection}.${action}`,
      // Minimal/best-effort payload (frontend refetches on the channel, A§7.1).
      payload: action === 'delete' ? { id: String(row.id) } : row,
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
      if (!frame.channels.some((c) => info.channels.has(c))) continue;
      try {
        socket.send(data);
      } catch {
        /* dead socket; cleaned up on close */
      }
    }
  }

  /** Workspace-membership authorization for a broadcast (the D2 boundary). */
  static canReceive(info: Pick<SocketInfo, 'workspaceIds'>, workspaceId?: string): boolean {
    if (workspaceId === undefined) return true; // unscoped resource (comments/kanban) — Django parity
    if (info.workspaceIds === null) return true; // platform admin
    return info.workspaceIds.has(workspaceId);
  }
}
