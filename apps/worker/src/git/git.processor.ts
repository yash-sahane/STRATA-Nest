import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import { GIT_JOB, Queues, type GitCommitInput, type GitJob } from '@lt/shared';
import { PrismaService } from '@lt/prisma';

const CLOSE_INTENT = /\b(fix(e[sd])?|close[sd]?|resolve[sd]?)\b/i;
// Task references in a commit message: `#ABC-12`, `#123`, or bare `ABC-123`.
const TASK_REF = /#([A-Za-z][\w-]*)|\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * Git CONSUMER (Phase 11). Records webhook commits idempotently (unique
 * project+sha), links referenced tasks parsed from messages, and — when the
 * integration opts in and the message signals a close — advances those tasks to
 * DONE. Then dispatches to Discord if configured. Idempotent + best-effort per
 * commit (one bad commit does not fail the batch).
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
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        db: this.config.get<number>('REDIS_QUEUE_DB', 1),
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

  /** Exposed for unit tests — process one job without a live queue. */
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
        const taskIds = await this.recordCommit(projectId, provider, commit, autoUpdate);
        recorded += 1;
        linked += taskIds.length;
      } catch (err) {
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
  ): Promise<string[]> {
    const refs = GitProcessor.parseTaskRefs(commit.message);
    // Resolve refs to real task ids within the project (by hierarchyId or id).
    const tasks = refs.length
      ? await this.prisma.task.findMany({
          where: { projectId, OR: [{ hierarchyId: { in: refs } }, { id: { in: refs } }] },
          select: { id: true },
        })
      : [];
    const taskIds = tasks.map((t) => t.id);

    // Idempotent on (project, sha) — provider re-deliveries are safe.
    await this.prisma.gitCommit.upsert({
      where: { projectId_commitSha: { projectId, commitSha: commit.sha } },
      create: {
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
      update: { linkedTaskIds: taskIds },
    });

    if (autoUpdate && taskIds.length && CLOSE_INTENT.test(commit.message)) {
      await this.prisma.task.updateMany({ where: { id: { in: taskIds } }, data: { status: 'DONE' } });
    }
    return taskIds;
  }

  private async dispatchDiscord(projectId: string, provider: string, recorded: number): Promise<void> {
    if (recorded === 0) return;
    const discord = await this.prisma.discordIntegration.findUnique({ where: { projectId } });
    if (!discord || typeof fetch !== 'function') return;
    try {
      await fetch(discord.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `${provider}: ${recorded} new commit(s) recorded.` }),
      });
    } catch (err) {
      this.logger.warn(`discord dispatch failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

/** 20-char id (matches the app's PK style) without importing @lt/common into the worker. */
function cryptoRandomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
