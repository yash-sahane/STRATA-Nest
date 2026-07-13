import { formatApiTimestamp } from '@strata/common';
import type {
  DiscordIntegration,
  GitCommit,
  GitHubIntegration,
  GitLabIntegration,
  Prisma,
} from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? [];

// accessToken is write-only — NEVER serialized back.
export function githubIntegrationResponse(g: GitHubIntegration) {
  return {
    id: String(g.id),
    projectId: g.projectId,
    repoOwner: g.repoOwner,
    repoName: g.repoName,
    webhookSecret: g.webhookSecret,
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
    webhookSecret: g.webhookSecret,
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
