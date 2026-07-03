import { toDjangoIso } from '@lt/common';
import type {
  DiscordIntegration,
  GitCommit,
  GitHubIntegration,
  GitLabIntegration,
  Prisma,
} from '@prisma/client';

const asJson = (v: Prisma.JsonValue): unknown => v ?? [];

// accessToken is write_only in Django — NEVER serialized back (D4).
export function githubIntegrationResponse(g: GitHubIntegration) {
  return {
    id: String(g.id),
    projectId: g.projectId,
    repoOwner: g.repoOwner,
    repoName: g.repoName,
    webhookSecret: g.webhookSecret,
    autoUpdateStatus: g.autoUpdateStatus,
    enabledEvents: asJson(g.enabledEvents),
    createdAt: toDjangoIso(g.createdAt),
    updatedAt: toDjangoIso(g.updatedAt),
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
    createdAt: toDjangoIso(g.createdAt),
    updatedAt: toDjangoIso(g.updatedAt),
  };
}

export function discordIntegrationResponse(d: DiscordIntegration) {
  return {
    id: String(d.id),
    projectId: d.projectId,
    webhookUrl: d.webhookUrl,
    enabledEvents: asJson(d.enabledEvents),
    createdAt: toDjangoIso(d.createdAt),
    updatedAt: toDjangoIso(d.updatedAt),
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
    timestamp: toDjangoIso(c.timestamp),
    linkedTaskIds: asJson(c.linkedTaskIds),
    url: c.url,
    createdAt: toDjangoIso(c.createdAt),
    updatedAt: toDjangoIso(c.updatedAt),
  };
}
