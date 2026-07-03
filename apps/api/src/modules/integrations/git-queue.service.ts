import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { GIT_JOB, Queues, type GitJob } from '@lt/shared';

/**
 * Producer for the `git` queue (Phase 11). The webhook controllers enqueue a
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

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
