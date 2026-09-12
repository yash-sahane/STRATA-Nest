import { formatApiTimestamp } from '@strata/common';
import type {
  DiscordIntegration,
  GitCommit,
  GitHubIntegration,
  GitLabIntegration,
  Prisma,
} from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? [];

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
    createdAt: formatApiTimestamp(g.createdAt),
    updatedAt: formatApiTimestamp(g.updatedAt),
  };
}

export function discordIntegrationResponse(d: DiscordIntegration) {
  return {
    id: String(d.id),
    projectId: d.projectId,
    webhookUrl: d.webhookUrl,
    enabledEvents: asJson(d.enabledEvents),
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
