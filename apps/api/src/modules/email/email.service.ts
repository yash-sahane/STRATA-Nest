import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redisConnection } from '@strata/config';
import { Queue } from 'bullmq';
import {
  EMAIL_HEALTH_KEY,
  EMAIL_JOB,
  Queues,
  parseEmailHealth,
  senderCanDeliver,
  type EmailJob,
} from '@strata/shared';

/**
 * Email PRODUCER. Adds jobs to the BullMQ `email` queue; the worker
 * sends them (Resend, else logs). Two transports:
 *  - `queue` (default): enqueue with retries/backoff; idempotencyKey → jobId so
 *    a duplicate enqueue is ignored.
 *  - `inline`: log synchronously — the fallback for when the worker is
 *    unavailable. A queue-add failure also falls back to log
 *    so a Redis outage never breaks the originating request (e.g. an invite).
 */
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Email');
  private queue?: Queue;
  /** The provider's last refusal of US (sender or key), as the worker recorded it. */
  private refusal: string | null = null;
  private healthTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {}

  private get transport(): string {
    return this.config.get<string>('EMAIL_TRANSPORT', 'queue');
  }

  /**
   * Whether a mail handed to `enqueue` can reach an inbox at all.
   *
   * Without RESEND_API_KEY the worker logs the subject line and drops the body,
   * and the inline transport does the same — so "enqueued" is not "sent". The
   * one place that MUST know is account creation: a new account's temporary
   * password exists nowhere but in that mail.
   */
  get delivers(): boolean {
    return this.undeliverableBecause === null;
  }

  /**
   * Whether mail is set up to be sent at all: the configuration, not the
   * provider's last answer. Notice mail is queued whenever this holds — gating
   * it on `delivers` meant a single refusal stopped every notice mail, and with
   * nothing queued nothing could succeed and lift it.
   */
  get configured(): boolean {
    return (
      this.transport === 'queue' &&
      Boolean(this.config.get<string>('RESEND_API_KEY', '')) &&
      senderCanDeliver(this.config.get<string>('EMAIL_FROM', ''))
    );
  }

  /**
   * Why mail will not arrive, or null when nothing says it will not.
   *
   * A key alone is not delivery. With the sender left on the placeholder
   * domain — or on any domain the provider has not verified — every message is
   * refused, and this used to go on answering "delivers" while a new account's
   * only password went nowhere. So besides the key: the sender has to be an
   * address a provider could accept, and the provider must not have just
   * refused us for a reason that is ours to fix (the worker records that; see
   * mail-health.ts in @strata/shared).
   */
  get undeliverableBecause(): string | null {
    if (this.transport !== 'queue') return 'Mail is only logged on this installation.';
    if (!this.config.get<string>('RESEND_API_KEY', '')) {
      return 'No mail provider is configured.';
    }
    const from = this.config.get<string>('EMAIL_FROM', '');
    if (!senderCanDeliver(from)) {
      return `The sender address (${from || 'unset'}) is a placeholder: EMAIL_FROM has to be on a domain verified with the mail provider.`;
    }
    return this.refusal ? `The mail provider is refusing messages: ${this.refusal}` : null;
  }

  /** Read the worker's last word on delivery. Never throws: mail still queues. */
  private async refreshHealth(): Promise<void> {
    if (!this.queue) return;
    try {
      const health = parseEmailHealth(await (await this.queue.client).get(EMAIL_HEALTH_KEY));
      this.refusal = health && !health.ok ? (health.reason ?? 'refused') : null;
    } catch (err) {
      this.logger.debug(`email health unreadable: ${(err as Error).message}`);
    }
  }

  onModuleInit(): void {
    if (this.transport !== 'queue') {
      this.logger.log('email transport: inline (logging; no queue)');
      return;
    }
    this.queue = new Queue(Queues.Email, {
      connection: redisConnection((key) => this.config.get(key), 'queue'),
    });
    // Never let a background connection error crash the process.
    this.queue.on('error', (err) => this.logger.warn(`email queue: ${err.message}`));
    this.logger.log(`email transport: queue (${Queues.Email})`);
    // Said once, loudly, at the moment somebody can still do something about it.
    void this.refreshHealth().then(() => {
      const why = this.undeliverableBecause;
      if (why && this.config.get<string>('RESEND_API_KEY', '')) {
        this.logger.warn(`mail will NOT be delivered — ${why}`);
      }
    });
    this.healthTimer = setInterval(() => void this.refreshHealth(), 30_000);
    this.healthTimer.unref();
  }

  async enqueue(job: EmailJob): Promise<void> {
    if (this.transport !== 'queue' || !this.queue) {
      this.logger.log(`[inline] ${job.kind} → ${job.to}: ${job.subject}`);
      return;
    }
    // Before the caller asks whether this will arrive: every place that decides
    // on `delivers` (a new account, a re-issued password) enqueues first.
    await this.refreshHealth();
    try {
      await this.queue.add(EMAIL_JOB, job, {
        // Dedupe re-enqueues. BullMQ forbids ':' in a custom job id (its key
        // namespace separator), so sanitize — the key stays deterministic, so
        // idempotency is preserved. Without this, every mail whose key contains
        // a ':' (reset/welcome/invite/notification) fails to enqueue.
        jobId: job.idempotencyKey ? job.idempotencyKey.replace(/:/g, '_') : undefined,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: job.dedupeForSeconds ? { age: job.dedupeForSeconds } : true,
        // Kept for inspection, but not for ever: a welcome mail's body carries
        // the account's temporary password.
        removeOnFail: { age: 7 * 24 * 60 * 60 },
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
    if (this.healthTimer) clearInterval(this.healthTimer);
    await this.queue?.close();
  }
}
