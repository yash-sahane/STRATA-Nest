/**
 * BullMQ queue contracts shared between the API producers and the worker
 * consumers (ADR-0007). Names and job payloads live here so both sides stay in
 * lockstep — the worker must never guess a queue name or job shape.
 */

/** Logical queue names (one BullMQ queue each, on the queue Redis DB). */
export const Queues = {
  Email: 'email',
} as const;
export type QueueName = (typeof Queues)[keyof typeof Queues];

/** The kinds of transactional email the system sends (Phases 1/2/9). */
export const EmailKind = {
  PasswordReset: 'password_reset',
  Welcome: 'welcome',
  WorkspaceInvitation: 'workspace_invitation',
  Notification: 'notification',
} as const;
export type EmailKind = (typeof EmailKind)[keyof typeof EmailKind];

/** Job name used when adding to the email queue (BullMQ `name`). */
export const EMAIL_JOB = 'send-email';

/**
 * Email job payload. `to`/`subject` are always present; `kind`-specific context
 * rides in `context`. The processor renders + sends (Resend, else logs). An
 * `idempotencyKey` (used as the BullMQ jobId) makes re-enqueues a no-op.
 */
export interface EmailJob {
  kind: EmailKind;
  /** One recipient, or many (Resend accepts an array; parity with Django). */
  to: string | string[];
  subject: string;
  /** Pre-rendered text body (kept simple; templating can grow later). */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Structured context for logging/observability + future templating. */
  context?: Record<string, unknown>;
  /** Dedupe key → BullMQ jobId; a duplicate enqueue is ignored. */
  idempotencyKey?: string;
}
