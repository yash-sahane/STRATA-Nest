import { Injectable, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type {
  DiscordIntegration,
  GitCommit,
  GitHubIntegration,
  GitLabIntegration,
  Prisma,
  User,
} from '@prisma/client';
import { writeAuditRow, type AuditAction } from '../activity/audit-writer';
import { Permission } from '../authz/permissions';
import { IntegrationAccess } from './integration-access.service';
import { TokenCipher } from './token-cipher';
import type {
  CreateDiscordIntegrationDto,
  CreateGitCommitDto,
  CreateGitHubIntegrationDto,
  CreateGitLabIntegrationDto,
  UpdateDiscordIntegrationDto,
  UpdateGitCommitDto,
  UpdateGitHubIntegrationDto,
  UpdateGitLabIntegrationDto,
} from './dto';
import {
  discordIntegrationResponse,
  gitCommitResponse,
  githubIntegrationResponse,
  gitlabIntegrationResponse,
} from './mappers';

/** Shared project-scoped CRUD for the integration collections (scoped to the caller's project). */
abstract class ProjectScopedService<TRow extends { projectId: string }, TResponse> {
  protected abstract readonly model: string;
  protected abstract readonly spec: ListQuerySpec;
  /** Entity name for the audit trail; see ScopedCrudService.auditEntity.
   *  These rows are project-scoped, so the workspace is resolved from the
   *  project before the row is written. */
  protected readonly auditEntity?: string;
  protected abstract map(row: TRow): TResponse;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly ia: IntegrationAccess,
  ) {}

  private get delegate() {
    return (this.prisma as unknown as Record<string, {
      findMany(a: unknown): Promise<unknown[]>;
      findFirst(a: unknown): Promise<unknown>;
      count(a: unknown): Promise<number>;
      create(a: unknown): Promise<unknown>;
      update(a: unknown): Promise<unknown>;
      delete(a: unknown): Promise<unknown>;
    }>)[this.model];
  }

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<TResponse>> {
    const scope = await this.ia.scopeWhere(user);
    const parsed = parseListQuery(query, this.spec);
    const where = { AND: [scope, parsed.where] };
    const [rows, total] = await Promise.all([
      this.delegate.findMany({ where, orderBy: parsed.orderBy, skip: parsed.skip, take: parsed.take }),
      this.delegate.count({ where }),
    ]);
    return paginate((rows as TRow[]).map((r) => this.map(r)), total, parsed.page, parsed.pageSize);
  }

  protected async findScoped(user: User, id: string): Promise<TRow> {
    const scope = await this.ia.scopeWhere(user);
    const row = await this.delegate.findFirst({ where: { AND: [scope, { id }] } });
    if (!row) throw new NotFoundException('Not found.');
    return row as TRow;
  }

  async retrieve(user: User, id: string): Promise<TResponse> {
    return this.map(await this.findScoped(user, id));
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    await this.ia.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);
    await this.delegate.delete({ where: { id } });
    await this.recordAudit(user, row.projectId, 'deleted', id, row as Record<string, unknown>);
  }

  /** Audit an integration write. The workspace comes from the owning project,
   *  since these rows carry only a projectId. */
  protected async recordAudit(
    user: User,
    projectId: string,
    action: AuditAction,
    entityId: string,
    row?: Record<string, unknown>,
    changedFields?: string[],
  ): Promise<void> {
    if (!this.auditEntity) return;
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      });
      await writeAuditRow(this.prisma, {
        workspaceId: project?.workspaceId,
        userId: user.id,
        entity: this.auditEntity,
        action,
        entityId,
        row,
        changedFields,
      });
    } catch {
      // Same contract as writeAuditRow: the trail never breaks the write it
      // records — including when the workspace lookup itself fails.
    }
  }

  protected async createRow(user: User, projectId: string, data: Record<string, unknown>): Promise<TResponse> {
    await this.ia.assertProjectWrite(user, projectId, Permission.IntegrationWrite);
    const row = (await this.delegate.create({ data: { id: generateId(), ...data } })) as TRow;
    const created = row as Record<string, unknown>;
    await this.recordAudit(user, projectId, 'created', String(created.id ?? ''), created);
    return this.map(row);
  }

  protected async updateRow(user: User, id: string, data: Record<string, unknown>): Promise<TResponse> {
    const row = await this.findScoped(user, id);
    await this.ia.assertProjectWrite(user, row.projectId, Permission.IntegrationWrite);
    const updated = (await this.delegate.update({ where: { id }, data })) as TRow;
    await this.recordAudit(
      user,
      row.projectId,
      'updated',
      id,
      updated as Record<string, unknown>,
      Object.keys(data),
    );
    return this.map(updated);
  }
}

@Injectable()
export class GitHubIntegrationsService extends ProjectScopedService<
  GitHubIntegration,
  ReturnType<typeof githubIntegrationResponse>
> {
  protected readonly model = 'gitHubIntegration';
  protected readonly auditEntity = 'github_integration';
  protected readonly spec: ListQuerySpec = {
    filterable: { projectId: { field: 'projectId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, ia: IntegrationAccess, private readonly cipher: TokenCipher) {
    super(prisma, ia);
  }
  protected map(row: GitHubIntegration) {
    return githubIntegrationResponse(row);
  }
  create(user: User, dto: CreateGitHubIntegrationDto) {
    return this.createRow(user, dto.projectId, {
      projectId: dto.projectId,
      repoOwner: dto.repoOwner,
      repoName: dto.repoName,
      accessToken: this.cipher.encrypt(dto.accessToken), // never store plaintext
      webhookSecret: dto.webhookSecret ?? '',
      autoUpdateStatus: dto.autoUpdateStatus ?? false,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateGitHubIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.repoOwner !== undefined) data.repoOwner = dto.repoOwner;
    if (dto.repoName !== undefined) data.repoName = dto.repoName;
    if (dto.accessToken !== undefined) data.accessToken = this.cipher.encrypt(dto.accessToken);
    if (dto.webhookSecret !== undefined) data.webhookSecret = dto.webhookSecret;
    if (dto.autoUpdateStatus !== undefined) data.autoUpdateStatus = dto.autoUpdateStatus;
    if (dto.enabledEvents !== undefined) data.enabledEvents = dto.enabledEvents as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }
}

@Injectable()
export class GitLabIntegrationsService extends ProjectScopedService<
  GitLabIntegration,
  ReturnType<typeof gitlabIntegrationResponse>
> {
  protected readonly model = 'gitLabIntegration';
  protected readonly auditEntity = 'gitlab_integration';
  protected readonly spec: ListQuerySpec = {
    filterable: { projectId: { field: 'projectId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, ia: IntegrationAccess, private readonly cipher: TokenCipher) {
    super(prisma, ia);
  }
  protected map(row: GitLabIntegration) {
    return gitlabIntegrationResponse(row);
  }
  create(user: User, dto: CreateGitLabIntegrationDto) {
    return this.createRow(user, dto.projectId, {
      projectId: dto.projectId,
      projectPath: dto.projectPath,
      accessToken: this.cipher.encrypt(dto.accessToken),
      webhookSecret: dto.webhookSecret ?? '',
      autoUpdateStatus: dto.autoUpdateStatus ?? false,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateGitLabIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.projectPath !== undefined) data.projectPath = dto.projectPath;
    if (dto.accessToken !== undefined) data.accessToken = this.cipher.encrypt(dto.accessToken);
    if (dto.webhookSecret !== undefined) data.webhookSecret = dto.webhookSecret;
    if (dto.autoUpdateStatus !== undefined) data.autoUpdateStatus = dto.autoUpdateStatus;
    if (dto.enabledEvents !== undefined) data.enabledEvents = dto.enabledEvents as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }
}

@Injectable()
export class DiscordIntegrationsService extends ProjectScopedService<
  DiscordIntegration,
  ReturnType<typeof discordIntegrationResponse>
> {
  protected readonly model = 'discordIntegration';
  protected readonly auditEntity = 'discord_integration';
  protected readonly spec: ListQuerySpec = {
    filterable: { projectId: { field: 'projectId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, ia: IntegrationAccess) {
    super(prisma, ia);
  }
  protected map(row: DiscordIntegration) {
    return discordIntegrationResponse(row);
  }
  create(user: User, dto: CreateDiscordIntegrationDto) {
    return this.createRow(user, dto.projectId, {
      projectId: dto.projectId,
      webhookUrl: dto.webhookUrl,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateDiscordIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.webhookUrl !== undefined) data.webhookUrl = dto.webhookUrl;
    if (dto.enabledEvents !== undefined) data.enabledEvents = dto.enabledEvents as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }
}

@Injectable()
export class GitCommitsService extends ProjectScopedService<
  GitCommit,
  ReturnType<typeof gitCommitResponse>
> {
  protected readonly model = 'gitCommit';
  protected readonly spec: ListQuerySpec = {
    filterable: {
      projectId: { field: 'projectId' },
      provider: { field: 'provider' },
      commitSha: { field: 'commitSha' },
    },
    sortable: { createdAt: 'createdAt', timestamp: 'timestamp' },
    defaultOrderBy: { timestamp: 'desc' },
  };
  constructor(prisma: PrismaService, ia: IntegrationAccess) {
    super(prisma, ia);
  }
  protected map(row: GitCommit) {
    return gitCommitResponse(row);
  }
  create(user: User, dto: CreateGitCommitDto) {
    return this.createRow(user, dto.projectId, {
      projectId: dto.projectId,
      provider: dto.provider,
      commitSha: dto.commitSha,
      message: dto.message,
      author: dto.author,
      authorEmail: dto.authorEmail,
      timestamp: new Date(dto.timestamp),
      url: dto.url,
      linkedTaskIds: (dto.linkedTaskIds ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateGitCommitDto) {
    const data: Record<string, unknown> = {};
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.linkedTaskIds !== undefined) data.linkedTaskIds = dto.linkedTaskIds as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }
}
