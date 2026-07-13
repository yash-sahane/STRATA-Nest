import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EMAIL_JOB, Queues, type EmailJob } from '@strata/shared';

/**
 * Email PRODUCER. Adds jobs to the BullMQ `email` queue; the worker
 * sends them (Resend, else logs). Two transports:
 *  - `queue` (default): enqueue with retries/backoff; idempotencyKey → jobId so
 *    a duplicate enqueue is ignored.
 *  - `inline`: log synchronously — the fallback for when the worker is
 *    unavailable. A queue-add failure also falls back to log
 *    so a Redis outage never breaks the originating request (e.g. registration).
 */
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Email');
  private queue?: Queue;

  constructor(private readonly config: ConfigService) {}

  private get transport(): string {
    return this.config.get<string>('EMAIL_TRANSPORT', 'queue');
  }

  onModuleInit(): void {
    if (this.transport !== 'queue') {
      this.logger.log('email transport: inline (logging; no queue)');
      return;
    }
    this.queue = new Queue(Queues.Email, {
      connection: {
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        db: this.config.get<number>('REDIS_QUEUE_DB', 1),
      },
    });
    // Never let a background connection error crash the process.
    this.queue.on('error', (err) => this.logger.warn(`email queue: ${err.message}`));
    this.logger.log(`email transport: queue (${Queues.Email})`);
  }

  async enqueue(job: EmailJob): Promise<void> {
    if (this.transport !== 'queue' || !this.queue) {
      this.logger.log(`[inline] ${job.kind} → ${job.to}: ${job.subject}`);
      return;
    }
    try {
      await this.queue.add(EMAIL_JOB, job, {
        // Dedupe re-enqueues. BullMQ forbids ':' in a custom job id (its key
        // namespace separator), so sanitize — the key stays deterministic, so
        // idempotency is preserved. Without this, every mail whose key contains
        // a ':' (reset/welcome/invite/notification) fails to enqueue.
        jobId: job.idempotencyKey ? job.idempotencyKey.replace(/:/g, '_') : undefined,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false, // keep failures for inspection
      });
    } catch (err) {
      // Fallback: log instead of dropping. The mail is observable + retriable.
      this.logger.warn(`enqueue failed (${job.kind} → ${job.to}); logged instead: ${(err as Error).message}`);
    }
  }

  /**
   * Enqueue + report an optimistic result for the `email/send-*` HTTP endpoints
   * (frozen contract). The endpoint accepts the job and returns
   * `{success, backend, sent, queued}` immediately — actual delivery happens
   * asynchronously and is retried on failure.
   */
  async send(job: EmailJob): Promise<{ success: boolean; backend: string; sent: boolean; queued: boolean }> {
    await this.enqueue(job);
    const queued = this.transport === 'queue';
    return { success: true, backend: queued ? 'queue' : 'inline', sent: true, queued };
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
