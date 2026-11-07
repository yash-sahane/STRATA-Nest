import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import {
  TaskEvents,
  WORKER_EVENTS_CHANNEL,
  type TasksMovedByCommit,
} from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { emitDomainEvent } from '../workspaces/domain-event';

/**
 * What the worker did to a task, said where the API can act on it.
 *
 * A commit that says "fixes #ABC-12" moves that task to Review. The worker does
 * it — a different process, with no event bus and no sockets — so the move was
 * silent in every sense: the reviewers it was waiting on were not told, and a
 * board somebody had open went on showing the card where it had been until it
 * was reloaded. The move itself was the only part that happened.
 *
 * The worker now says what it moved on a Redis channel, and this turns that
 * into the same two things an edit through the API produces: the row announced
 * to open screens, and `task.status_changed`, from which the reviewers are
 * notified exactly as if a person had pressed the button.
 */
@Injectable()
export class WorkerEventsBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WorkerEvents');
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.subscriber = this.redis.duplicate();
    this.subscriber
      .subscribe(WORKER_EVENTS_CHANNEL)
      .catch((e: Error) => this.logger.warn(`worker events subscribe failed: ${e.message}`));
    this.subscriber.on('message', (_channel, raw) => {
      void this.handle(raw).catch((e: Error) =>
        this.logger.warn(`worker event not applied: ${e.message}`),
      );
    });
  }

  /**
   * Pub/sub hands every message to EVERY API instance, and each would notify
   * and mail the reviewers: two replicas, two of everything. The first instance
   * to claim the message's id acts on it; the realtime frames still reach every
   * instance's sockets through the realtime fan-out. A message with no id (from
   * a worker older than this) is acted on, as before.
   */
  private async claim(id: string | undefined): Promise<boolean> {
    if (!id) return true;
    try {
      return (await this.redis.set(`strata:worker-events:claimed:${id}`, '1', 'EX', 3600, 'NX')) === 'OK';
    } catch {
      return true; // a claim that cannot be made must not lose the event
    }
  }

  /** Closed explicitly: a duplicated subscriber left open holds the process up. */
  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Exposed for unit testing without a Redis connection. */
  async handle(raw: string): Promise<void> {
    let message: TasksMovedByCommit;
    try {
      message = JSON.parse(raw) as TasksMovedByCommit;
    } catch {
      return;
    }
    if (message?.kind !== 'tasks.moved_by_commit' || !Array.isArray(message.moves)) return;
    if (!(await this.claim(message.id))) return;

    const rows = await this.prisma.task.findMany({
      where: { id: { in: message.moves.map((move) => move.taskId) } },
    });
    const short = String(message.commit?.sha ?? '').slice(0, 7);
    const actorName = `${message.commit?.author || 'A commit'}${short ? ` (commit ${short})` : ''}`;
    for (const row of rows) {
      const from = message.moves.find((move) => move.taskId === row.id)?.from ?? '';
      // Open screens first: the card moves whether or not anybody is notified.
      this.prisma.announceWrite?.('Task', 'update', row);
      emitDomainEvent(this.events, TaskEvents.StatusChanged, row.workspaceId, {
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        taskId: row.id,
        title: row.title,
        hierarchyId: row.hierarchyId,
        // Nobody signed in did this, so nobody is left out of the notice for
        // having done it.
        actorId: '',
        actorName,
        from,
        to: row.status,
        assigneeIds: Array.isArray(row.assigneeIds) ? (row.assigneeIds as string[]) : [],
        sprintId: row.sprintId ?? '',
      });
    }

    // The requirement and epic the worker re-summed: their rows changed too.
    const requirements = await this.prisma.functionalRequirement.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.functionalRequirementId).filter(Boolean))] } },
    });
    for (const row of requirements) this.prisma.announceWrite?.('FunctionalRequirement', 'update', row);
    const epics = await this.prisma.epic.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.epicId).filter(Boolean))] } },
    });
    for (const row of epics) this.prisma.announceWrite?.('Epic', 'update', row);
  }
}
