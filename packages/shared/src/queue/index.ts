/**
 * BullMQ queue contracts shared between the API producers and the worker
 * consumers. Names and job payloads live here so both sides stay in
 * lockstep — the worker must never guess a queue name or job shape.
 */

/** Logical queue names (one BullMQ queue each, on the queue Redis DB). */
export const Queues = {
  Email: 'email',
  Git: 'git',
} as const;
export type QueueName = (typeof Queues)[keyof typeof Queues];

/** The kinds of transactional email the system sends. */
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
  /** One recipient, or many (Resend accepts an array). */
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

/** Job name used when adding to the git queue. */
export const GIT_JOB = 'process-webhook';

/** A single commit as it arrives in a provider webhook payload. */
export interface GitCommitInput {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  url: string;
}

/**
 * Git webhook job. The API webhook controllers verify the provider
 * signature, normalize the payload to `commits`, and enqueue this; the worker's
 * git processor records commits idempotently, links tasks, and (when the
 * integration opts in) auto-updates task status. `deliveryId` → jobId dedupes
 * provider re-deliveries.
 */
export interface GitJob {
  provider: 'GITHUB' | 'GITLAB';
  projectId: string;
  event: string;
  commits: GitCommitInput[];
  deliveryId?: string;
}
