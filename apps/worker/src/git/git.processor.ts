import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisConnection } from '@strata/config';
import { Worker, type Job } from 'bullmq';
import {
  Queues,
  isDiscordWebhookUrl,
  type GitCommitInput,
  type GitJob,
  WORKER_EVENTS_CHANNEL,
  type TasksMovedByCommit,
} from '@strata/shared';
import { PrismaService, refreshDeliveryRollups } from '@strata/prisma';
import { randomUUID } from 'node:crypto';

/** The statuses a "fixes #…" commit moves a task on FROM. Review and Done are
 *  left where they are: the first is already there, the second is finished. */
const BEFORE_REVIEW = ['BACKLOG', 'TODO', 'IN_PROGRESS'];
// Task references in a commit message: `#ABC-12`, `#PRJ-T03`, a subtask's
// `#PRJ-T03.1`, or bare `ABC-123`. The dotted tail is part of the id — without
// it a commit naming a subtask was linked to its parent instead — but a full
// stop that merely ends the sentence is not.
const TASK_REF = /#([A-Za-z][\w-]*(?:\.\d+)*)|\b([A-Z][A-Z0-9]+-\d+)\b/g;
/**
 * A closing keyword DIRECTLY before a reference — "fixes #PRJ-T03", "Closes:
 * PRJ-12" — which is the only thing that says this commit closes it (GitHub's
 * own rule). The keyword used to count anywhere in the message, so "WIP
 * #PRJ-T03, still need to fix tests" sent the task to Review. Case-insensitive
 * for the keyword only: a bare reference is held to TASK_REF's upper case
 * after the match (see closingRefs), so "fixes utf-8" names nothing.
 */
const CLOSING_REF = new RegExp(
  String.raw`\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?):?\s+(?:${TASK_REF.source})`,
  'gi',
);
const BARE_REF = /^[A-Z][A-Z0-9]+-\d+$/;
/**
 * A revert: git's `Revert "…"` subject (on any line, which is where a merged
 * revert pull request puts it) or its "This reverts commit <sha>" line. It
 * quotes the commit it undoes, "fixes #PRJ-T03" and all — taking a fix back
 * closes nothing.
 */
const REVERT = /^\s*revert\b|\bthis reverts commit\b/im;

/**
 * Whether a failure is the DATABASE's rather than one commit's data. Those are
 * the job's to retry: swallowed per commit, as everything was, a connection
 * dropped mid-batch "succeeded" the job, BullMQ's five attempts never ran, and
 * the commits it had not reached were lost without a trace.
 *
 * By class name, the way the API's exception filter tells Prisma errors apart:
 * the engine could not connect, died, or could not say what went wrong. And the
 * known-request codes that are about the connection rather than the row — P1xxx
 * (server unreachable, timed out, connection closed), P2024 (no connection free
 * in the pool), P2028 (the transaction itself failed or timed out), P2034 (a
 * deadlock or write conflict, where retrying IS the remedy). Anything else — a
 * constraint, an invalid value, a malformed payload — is that commit's, and
 * retrying would only fail the same way.
 */
const INFRASTRUCTURE_ERRORS = new Set([
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'PrismaClientUnknownRequestError',
]);
const TRANSIENT_CODE = /^(P1\d{3}|P2024|P2028|P2034)$/;

export function isInfrastructureError(err: unknown): boolean {
  const name = (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? '';
  if (INFRASTRUCTURE_ERRORS.has(name)) return true;
  const code = (err as { code?: unknown } | null)?.code;
  return (
    name === 'PrismaClientKnownRequestError' && typeof code === 'string' && TRANSIENT_CODE.test(code)
  );
}

/**
 * Git CONSUMER. Records webhook commits idempotently (unique
 * project+sha), links referenced tasks parsed from messages, and — when the
 * integration opts in and the message says the commit fixes them — moves those
 * tasks to REVIEW. Then dispatches to Discord if configured. Best-effort per
 * commit for the commit's own data (one bad commit does not fail the batch);
 * a database failure fails the job, so BullMQ retries it.
 *
 * The side effects — the move, its announcement, the Discord count — belong to
 * the FIRST time a commit is recorded, never to seeing it again. The same sha
 * arrives again whenever a branch is merged or pushed elsewhere, and the
 * delivery-id dedupe only lasts as long as the job does (removeOnComplete), so
 * the upsert that used to record it could not tell a new commit from an old
 * one: a merge re-posted to Discord and sent a task somebody had since taken
 * out of Review straight back into it.
 *
 * REVIEW, not DONE. This used to write `status: 'DONE'` straight onto the row,
 * which is the one transition the API guards hardest: a task has to pass through
 * review, completing it takes `task:write`, and `completedAt` is stamped as it
 * happens. A push did none of that — any developer could finish any task from a
 * commit message, and the row came out DONE with no completion date. Code that
 * has landed is ready to be looked at, which is exactly what REVIEW means; a
 * person still closes it.
 */
@Injectable()
export class GitProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GitProcessor');
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<GitJob>(Queues.Git, (job) => this.handle(job), {
      connection: {
        ...redisConnection((key) => this.config.get(key), 'queue'),
        maxRetriesPerRequest: null,
      },
    });
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`git ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.worker.on('error', (err) => this.logger.warn(`git worker: ${err.message}`));
    this.logger.log(`git processor listening on "${Queues.Git}"`);
  }

  /** Extract candidate task references (hierarchy ids or numeric ids) from text. */
  static parseTaskRefs(message: string): string[] {
    const refs = new Set<string>();
    for (const m of message.matchAll(TASK_REF)) {
      const ref = m[1] ?? m[2];
      if (ref) refs.add(ref);
    }
    return [...refs];
  }

  /** The references the message says it closes: each one directly after a
   *  closing keyword, and none at all in a revert. Always a subset of
   *  parseTaskRefs. */
  static closingRefs(message: string): string[] {
    if (REVERT.test(message)) return [];
    const refs = new Set<string>();
    for (const m of message.matchAll(CLOSING_REF)) {
      const ref = m[1] ?? (m[2] && BARE_REF.test(m[2]) ? m[2] : undefined);
      if (ref) refs.add(ref);
    }
    return [...refs];
  }

  /**
   * Exposed for unit tests — process one job without a live queue. `recorded`
   * counts the commits recorded for the first time; `linked`, the task links of
   * every commit in the job.
   */
  async handle(job: Job<GitJob> | { data: GitJob }): Promise<{ recorded: number; linked: number }> {
    const { provider, projectId, commits } = job.data;
    const github =
      provider === 'GITHUB'
        ? await this.prisma.gitHubIntegration.findUnique({ where: { projectId } })
        : null;
    const gitlab =
      provider === 'GITLAB'
        ? await this.prisma.gitLabIntegration.findUnique({ where: { projectId } })
        : null;
    const autoUpdate = Boolean(github?.autoUpdateStatus || gitlab?.autoUpdateStatus);

    let recorded = 0;
    let linked = 0;
    for (const commit of commits) {
      try {
        const { inserted, taskIds } = await this.recordCommit(projectId, provider, commit, autoUpdate);
        if (inserted) recorded += 1;
        linked += taskIds.length;
      } catch (err) {
        // Thrown, the job is retried: the commits recorded before this one are
        // then found already there and skipped, and the rest are tried again.
        if (isInfrastructureError(err)) throw err;
        this.logger.warn(`commit ${commit.sha} failed: ${(err as Error).message}`);
      }
    }
    await this.dispatchDiscord(projectId, provider, recorded);
    return { recorded, linked };
  }

  private async recordCommit(
    projectId: string,
    provider: string,
    commit: GitCommitInput,
    autoUpdate: boolean,
  ): Promise<{ inserted: boolean; taskIds: string[] }> {
    const refs = GitProcessor.parseTaskRefs(commit.message);
    // Resolve refs to real task ids within the project (by hierarchyId or id).
    const tasks = refs.length
      ? await this.prisma.task.findMany({
          where: { projectId, OR: [{ hierarchyId: { in: refs } }, { id: { in: refs } }] },
          select: { id: true, hierarchyId: true },
        })
      : [];
    const taskIds = tasks.map((t) => t.id);
    const closing = autoUpdate ? GitProcessor.closingRefs(commit.message) : [];
    const closingIds = tasks
      .filter((t) => closing.includes(t.hierarchyId) || closing.includes(t.id))
      .map((t) => t.id);

    // The insert decides whether this commit is new — ON CONFLICT DO NOTHING
    // counts 0 for a sha already recorded, and of two jobs racing on one sha
    // exactly one counts 1. The move is in the same transaction, so a failure
    // between the two rolls both back and the retry does both; recorded first
    // and moved separately, a retry would find the commit "old" and never move.
    // Resolves to the tasks it moved, or null when the commit was not new.
    const moved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.gitCommit.createMany({
        data: [
          {
            id: cryptoRandomId(),
            projectId,
            provider,
            commitSha: commit.sha,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            timestamp: new Date(commit.timestamp),
            url: commit.url,
            linkedTaskIds: taskIds,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) {
        // Seen before: its links are refreshed, and nothing else happens.
        await tx.gitCommit.updateMany({
          where: { projectId, commitSha: commit.sha },
          data: { linkedTaskIds: taskIds },
        });
        return null;
      }
      if (closingIds.length === 0) return [];
      const found = await tx.task.findMany({
        where: { id: { in: closingIds }, status: { in: BEFORE_REVIEW } },
        select: { id: true, status: true, functionalRequirementId: true, epicId: true },
      });
      if (found.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: found.map((t) => t.id) }, status: { in: BEFORE_REVIEW } },
          data: { status: 'REVIEW', version: { increment: 1 } },
        });
      }
      return found;
    });
    const moving = moved ?? [];

    if (moving.length > 0) {
      // A task in review is work under way, which is what its requirement and
      // epic report. Nothing re-summed them for a move made from here, so a
      // requirement whose every task had been pushed still read "Planned".
      await refreshDeliveryRollups(
        this.prisma,
        {
          functionalRequirementIds: moving.map((t) => t.functionalRequirementId),
          epicIds: moving.map((t) => t.epicId),
        },
        (error, kind, id) =>
          this.logger.warn(`roll-up of ${kind} ${id} failed: ${(error as Error).message}`),
      );
      await this.announceMoves(projectId, commit, moving);
    }
    return { inserted: moved !== null, taskIds };
  }

  /**
   * Tell the API which tasks this commit moved. It is the API that can notify
   * the reviewers and redraw open boards; from here the move was silent.
   * Best-effort: the tasks have moved whether or not anybody hears about it.
   */
  private async announceMoves(
    projectId: string,
    commit: GitCommitInput,
    moved: ReadonlyArray<{ id: string; status: string }>,
  ): Promise<void> {
    if (moved.length === 0) return;
    const message: TasksMovedByCommit = {
      kind: 'tasks.moved_by_commit',
      id: randomUUID(),
      projectId,
      moves: moved.map((task) => ({ taskId: task.id, from: task.status })),
      commit: { sha: commit.sha, author: commit.author },
    };
    try {
      // BullMQ types its connection by the commands BullMQ itself uses; the
      // object behind it is an ordinary Redis client.
      const client = (await this.worker?.client) as unknown as
        | { publish(channel: string, message: string): Promise<number> }
        | undefined;
      await client?.publish(WORKER_EVENTS_CHANNEL, JSON.stringify(message));
    } catch (err) {
      this.logger.warn(`moved tasks not announced: ${(err as Error).message}`);
    }
  }

  private async dispatchDiscord(projectId: string, provider: string, recorded: number): Promise<void> {
    if (recorded === 0) return;
    const discord = await this.prisma.discordIntegration.findUnique({ where: { projectId } });
    if (!discord || typeof fetch !== 'function') return;
    // The API refuses to store anything else now, but rows saved before it did
    // are still here, and this process would POST to wherever they point.
    if (!isDiscordWebhookUrl(discord.webhookUrl)) {
      this.logger.warn(`discord dispatch skipped for project ${projectId}: not a Discord webhook URL`);
      return;
    }
    const source = provider === 'GITLAB' ? 'GitLab' : 'GitHub';
    try {
      await fetch(discord.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: `${recorded} new ${recorded === 1 ? 'commit' : 'commits'} pushed to ${source}.`,
          // A commit message is not a place anybody expects to ping a channel from.
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.warn(`discord dispatch failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

/** 20-char id (matches the app's PK style) without importing @strata/common into the worker. */
function cryptoRandomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
