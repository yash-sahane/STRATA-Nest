import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GitCommitInput } from '@strata/shared';

/** Constant-time string compare (avoids length/short-circuit timing leaks). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * GitHub webhook: HMAC-SHA256 of the raw body keyed by the webhook secret,
 * compared against the `X-Hub-Signature-256: sha256=<hex>` header. An empty
 * secret means the integration didn't configure verification → reject.
 */
export function verifyGithubSignature(rawBody: Buffer, secret: string, header?: string): boolean {
  if (!secret || !header) return false;
  const digest = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(digest, header);
}

/** GitLab webhook: shared-token compare against the `X-Gitlab-Token` header. */
export function verifyGitlabToken(secret: string, header?: string): boolean {
  if (!secret || !header) return false;
  return safeEqual(secret, header);
}

interface RawCommit {
  id?: string;
  sha?: string;
  message?: string;
  timestamp?: string;
  url?: string;
  author?: { name?: string; email?: string };
}

/** Normalize a GitHub/GitLab push payload's commits to the shared shape. */
export function normalizeCommits(payload: unknown): GitCommitInput[] {
  const commits = (payload as { commits?: RawCommit[] })?.commits;
  if (!Array.isArray(commits)) return [];
  return commits.map((c) => ({
    sha: c.sha ?? c.id ?? '',
    message: c.message ?? '',
    author: c.author?.name ?? '',
    authorEmail: c.author?.email ?? '',
    timestamp: c.timestamp ?? new Date().toISOString(),
    url: c.url ?? '',
  })).filter((c) => c.sha);
}
