import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { GIT_JOB, Queues, type GitJob } from '@strata/shared';

/**
 * Producer for the `git` queue. The webhook controllers enqueue a
 * normalized {@link GitJob}; the worker's git processor records commits + runs
 * side effects. `deliveryId` → jobId dedupes provider re-deliveries.
 */
@Injectable()
export class GitQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GitQueue');
  private queue?: Queue;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.queue = new Queue(Queues.Git, {
      connection: {
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        db: this.config.get<number>('REDIS_QUEUE_DB', 1),
      },
    });
    this.queue.on('error', (err) => this.logger.warn(`git queue: ${err.message}`));
  }

  async enqueue(job: GitJob): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(GIT_JOB, job, {
      jobId: job.deliveryId, // dedupe provider re-deliveries
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  /**
   * Best-effort removal of pending git jobs referencing deleted projects
   * (delete-semantics Zone 2). Scans waiting + delayed jobs and removes those
   * whose payload targets one of `projectIds`. Active/completed jobs are left
   * alone. Returns the number removed.
   */
  async purgeByProjectIds(projectIds: string[]): Promise<number> {
    if (!this.queue || projectIds.length === 0) return 0;
    const set = new Set(projectIds);
    const jobs = await this.queue.getJobs(['waiting', 'delayed', 'paused']);
    let removed = 0;
    for (const job of jobs) {
      const pid = (job?.data as GitJob | undefined)?.projectId;
      if (pid && set.has(pid)) {
        await job.remove().catch(() => undefined);
        removed += 1;
      }
    }
    if (removed) this.logger.log(`purged ${removed} git job(s) for deleted project(s)`);
    return removed;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
