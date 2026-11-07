import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import type { Task } from '@prisma/client';
import { generateId } from '@strata/common';
import {
  TaskEvents,
  WORKER_EVENTS_CHANNEL,
  type TasksMovedByCommit,
} from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { normalizeEmail } from '../auth/auth.service';
import { emitDomainEvent } from '../workspaces/domain-event';

/** The audit trail's action for a task a commit moved — its own, see recordInTrail. */
export const TASK_MOVED_BY_COMMIT = 'task.moved_by_commit';

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
 * into what an edit through the API produces: the row announced to open
 * screens; `task.status_changed`, from which the reviewers are notified exactly
 * as if a person had pressed the button; and a row in the audit trail.
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

    await this.recordInTrail(message, rows);

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

  /**
   * One audit-trail row per task the commit moved.
   *
   * The trail had none. A move made by a person is recorded by the task's own
   * write (`task.updated`); this one has no request behind it, so a card went to
   * Review with no trace of why or by whom. Written here, after the claim, so one
   * API instance writes it however many hear the message — and not through
   * AuditSubscriber from `task.status_changed`, which fires for every move made
   * through the API as well, each already in the trail.
   *
   * The row is credited to the workspace member whose address the commit
   * carries. Git does not check that address — it is whatever the committer
   * configured — so this is the repository's own account of who wrote it, as
   * GitHub's is; the row keeps the commit and the name it gave beside it. With
   * no such member (an outside contributor, GitHub's no-reply address, a worker
   * too old to send the address) the row has no user, and the feed shows the
   * commit's own name.
   *
   * One `create` per row rather than createMany: the write hook announces each,
   * so an open activity feed shows them as they land. Best effort, as every
   * audit write is — the move happened whether or not it was written down.
   */
  private async recordInTrail(message: TasksMovedByCommit, rows: Task[]): Promise<void> {
    if (rows.length === 0) return;
    const sha = String(message.commit?.sha ?? '');
    const author = String(message.commit?.author ?? '').trim();
    try {
      const actors = new Map<string, string>();
      for (const workspaceId of new Set(rows.map((row) => row.workspaceId))) {
        actors.set(workspaceId, await this.memberWithAddress(workspaceId, message.commit?.authorEmail));
      }
      for (const row of rows) {
        const move = message.moves.find((m) => m.taskId === row.id);
        await this.prisma.activityLog.create({
          data: {
            id: generateId(),
            workspaceId: row.workspaceId,
            // NULL, not '': the column is a foreign key to accounts_user, and an
            // empty id failed it — so the row for an outside contributor's commit
            // was refused outright and the move never reached the trail.
            userId: actors.get(row.workspaceId) || null,
            action: TASK_MOVED_BY_COMMIT,
            entityType: 'task',
            entityId: row.id,
            // The worker only ever moves a task to Review; `to` says so outright
            // from any worker new enough to send it.
            changes: { status: [move?.from ?? '', move?.to ?? 'REVIEW'] },
            metadata: {
              label: row.title,
              hierarchyId: row.hierarchyId,
              projectId: row.projectId,
              commitSha: sha,
              ...(author ? { commitAuthor: author } : {}),
            },
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `moves by commit ${sha.slice(0, 7) || '?'} not written to the audit trail: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The member of `workspaceId` whose account has this address, or '' for none.
   * Someone invited and yet to answer is not a member (invitation-consent), so
   * not them; somebody whose access was switched off since is still the person
   * who wrote the commit.
   */
  private async memberWithAddress(workspaceId: string, address: string | undefined): Promise<string> {
    const email = normalizeEmail(address ?? '');
    if (!email) return '';
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return '';
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      select: { status: true },
    });
    return membership && membership.status !== 'INVITED' ? user.id : '';
  }
}
