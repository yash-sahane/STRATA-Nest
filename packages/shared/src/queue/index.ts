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
  /**
   * How long a SENT job is remembered, so that a repeat enqueue under the same
   * key is still ignored. Unset, a finished job is forgotten immediately. Only
   * for mails whose body is harmless to keep: the job data stays in Redis for
   * the window.
   */
  dedupeForSeconds?: number;
}

/**
 * Where the worker says what it changed, for the API to act on (pub/sub; the
 * channel is the same in every Redis database). The worker has no event bus and
 * no sockets of its own — see WorkerEventsBridge in the API.
 */
export const WORKER_EVENTS_CHANNEL = 'strata:worker-events';

/** Tasks a commit moved to Review, and where each of them was before. */
export interface TasksMovedByCommit {
  kind: 'tasks.moved_by_commit';
  /** Unique per message: every API instance hears it, and only the first acts on it. */
  id?: string;
  projectId: string;
  moves: Array<{ taskId: string; from: string }>;
  commit: { sha: string; author: string };
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
