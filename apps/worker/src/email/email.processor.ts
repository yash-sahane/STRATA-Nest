import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import { Queues, type EmailJob } from '@strata/shared';

/**
 * Email CONSUMER. A BullMQ Worker on the `email` queue that renders
 * + sends each job. Transport: Resend when RESEND_API_KEY is set AND the SDK is
 * installed; otherwise it logs (dev fallback). A thrown
 * error triggers BullMQ's configured retries/backoff; a permanent condition
 * (no key / no SDK) resolves as a log so the job doesn't retry forever.
 */
/** The slice of the Resend SDK this processor uses. `send` RESOLVES with an
 *  `error` rather than rejecting, which is why the result is inspected. */
interface ResendLike {
  emails: {
    send: (options: unknown) => Promise<{ error?: { message?: string; name?: string } | null } | null>;
  };
}

@Injectable()
export class EmailProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EmailProcessor');
  private worker?: Worker;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.worker = new Worker<EmailJob>(
      Queues.Email,
      (job) => this.handle(job),
      {
        connection: {
          host: this.config.get<string>('REDIS_HOST', 'localhost'),
          port: this.config.get<number>('REDIS_PORT', 6379),
          db: this.config.get<number>('REDIS_QUEUE_DB', 1),
          maxRetriesPerRequest: null, // required for BullMQ workers
        },
      },
    );
    this.worker.on('completed', (job) =>
      this.logger.debug(`email ${job.id} sent (${job.data.kind} → ${job.data.to})`),
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`email ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    );
    this.worker.on('error', (err) => this.logger.warn(`email worker: ${err.message}`));
    this.logger.log(`email processor listening on "${Queues.Email}"`);
  }

  /** Exposed for unit testing the send/fallback logic without a live queue. */
  async handle(job: Job<EmailJob> | { data: EmailJob }): Promise<{ delivered: 'resend' | 'log' }> {
    const email = job.data;
    const apiKey = this.config.get<string>('RESEND_API_KEY', '');
    if (!apiKey) {
      this.logger.log(`[log-only] ${email.kind} → ${email.to}: ${email.subject}`);
      return { delivered: 'log' };
    }
    const resend = await this.loadResend(apiKey);
    if (!resend) {
      this.logger.warn(`resend SDK unavailable; logged ${email.kind} → ${email.to}`);
      return { delivered: 'log' };
    }
    const result = await resend.emails.send({
      from: this.config.get<string>('EMAIL_FROM', 'noreply@example.com'),
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    /**
     * The SDK RESOLVES with `{ data, error }` instead of throwing, so an
     * unchecked call reported a refusal as a successful send: a 403 for an
     * unverified sending domain still logged "sent" and BullMQ marked the job
     * complete, so it was never retried and nothing surfaced the failure.
     * Throwing hands the job back to BullMQ's retry/failed handling.
     */
    if (result?.error) {
      const { message, name } = result.error;
      throw new Error(`resend refused the message: ${message ?? name ?? 'unknown error'}`);
    }
    return { delivered: 'resend' };
  }

  /** Lazy-load the optional Resend SDK; null if it is not installed. The
   *  specifier is computed so the build does not require the package present. */
  private async loadResend(apiKey: string): Promise<ResendLike | null> {
    try {
      const specifier = 'resend';
      const mod = (await import(specifier)) as { Resend: new (k: string) => never };
      return new mod.Resend(apiKey) as never;
    } catch {
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
