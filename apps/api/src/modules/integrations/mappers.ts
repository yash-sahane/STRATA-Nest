import { formatApiTimestamp } from '@strata/common';
import type {
  DiscordIntegration,
  GitCommit,
  GitHubIntegration,
  GitLabIntegration,
  Prisma,
} from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? [];

/**
 * Where a provider delivers its webhooks for a project, relative to the API's
 * global prefix. Reported with the row so the screen that tells somebody what
 * to paste into GitHub is not guessing at a route.
 */
export const webhookPath = (provider: 'github' | 'gitlab', projectId: string): string =>
  `/integrations/${provider}/webhook/${projectId}`;

/** The id segment of a Discord webhook URL, cut down to a recognisable tail. */
function discordHint(webhookUrl: string): string {
  const id = webhookUrl.split('/').filter(Boolean).slice(-2, -1)[0] ?? '';
  return id.slice(-6);
}

// Credentials are write-only — NEVER serialized back. accessToken was already
// omitted; webhookSecret was not, so any member of the workspace could read it
// from a plain list call and forge signed webhooks against the project.
export function githubIntegrationResponse(g: GitHubIntegration) {
  return {
    id: String(g.id),
    projectId: g.projectId,
    repoOwner: g.repoOwner,
    repoName: g.repoName,
    autoUpdateStatus: g.autoUpdateStatus,
    enabledEvents: asJson(g.enabledEvents),
    // Whether a signing secret exists — never the secret. Without one every
    // delivery is refused, so "connected" alone would be a half-truth.
    webhookConfigured: Boolean(g.webhookSecret),
    webhookPath: webhookPath('github', g.projectId),
    // Whether this credential has ever been shown to work. Null = never tested,
    // which is a state the UI shows rather than a blank it has to interpret.
    lastTestedAt: g.lastTestedAt ? formatApiTimestamp(g.lastTestedAt) : null,
    lastTestOk: g.lastTestOk,
    lastTestError: g.lastTestError ?? null,
    createdAt: formatApiTimestamp(g.createdAt),
    updatedAt: formatApiTimestamp(g.updatedAt),
  };
}

export function gitlabIntegrationResponse(g: GitLabIntegration) {
  return {
    id: String(g.id),
    projectId: g.projectId,
    projectPath: g.projectPath,
    autoUpdateStatus: g.autoUpdateStatus,
    enabledEvents: asJson(g.enabledEvents),
    webhookConfigured: Boolean(g.webhookSecret),
    webhookPath: webhookPath('gitlab', g.projectId),
    // Whether this credential has ever been shown to work. Null = never tested,
    // which is a state the UI shows rather than a blank it has to interpret.
    lastTestedAt: g.lastTestedAt ? formatApiTimestamp(g.lastTestedAt) : null,
    lastTestOk: g.lastTestOk,
    lastTestError: g.lastTestError ?? null,
    createdAt: formatApiTimestamp(g.createdAt),
    updatedAt: formatApiTimestamp(g.updatedAt),
  };
}

export function discordIntegrationResponse(d: DiscordIntegration) {
  return {
    id: String(d.id),
    projectId: d.projectId,
    // A Discord webhook URL IS the credential: anybody holding it can post to
    // the channel. It used to be serialized whole, to every member of the
    // workspace (integration:read is in the baseline). A tail is enough to tell
    // one webhook from another.
    webhookHint: discordHint(d.webhookUrl),
    enabledEvents: asJson(d.enabledEvents),
    // Whether this credential has ever been shown to work. Null = never tested,
    // which is a state the UI shows rather than a blank it has to interpret.
    lastTestedAt: d.lastTestedAt ? formatApiTimestamp(d.lastTestedAt) : null,
    lastTestOk: d.lastTestOk,
    lastTestError: d.lastTestError ?? null,
    createdAt: formatApiTimestamp(d.createdAt),
    updatedAt: formatApiTimestamp(d.updatedAt),
  };
}

export function gitCommitResponse(c: GitCommit) {
  return {
    id: String(c.id),
    projectId: c.projectId,
    provider: c.provider,
    commitSha: c.commitSha,
    message: c.message,
    author: c.author,
    authorEmail: c.authorEmail,
    timestamp: formatApiTimestamp(c.timestamp),
    linkedTaskIds: asJson(c.linkedTaskIds),
    url: c.url,
    createdAt: formatApiTimestamp(c.createdAt),
    updatedAt: formatApiTimestamp(c.updatedAt),
  };
}
