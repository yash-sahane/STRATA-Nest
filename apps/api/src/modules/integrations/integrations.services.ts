import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import { isDiscordWebhookUrl, type PaginatedResponse } from '@strata/shared';
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
  CreateGitHubIntegrationDto,
  CreateGitLabIntegrationDto,
  UpdateDiscordIntegrationDto,
  UpdateGitHubIntegrationDto,
  UpdateGitLabIntegrationDto,
} from './dto';
import {
  discordIntegrationResponse,
  gitCommitResponse,
  githubIntegrationResponse,
  gitlabIntegrationResponse,
} from './mappers';

/** 256 bits, hex: what a provider is given to sign or stamp its deliveries. */
const newWebhookSecret = (): string => randomBytes(32).toString('hex');

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
    /** A predicate the list-query grammar cannot express, ANDed with the rest. */
    extraWhere?: Record<string, unknown>,
  ): Promise<PaginatedResponse<TResponse>> {
    const scope = await this.ia.scopeWhere(user);
    const parsed = parseListQuery(query, this.spec);
    const where = { AND: [scope, parsed.where, ...(extraWhere ? [extraWhere] : [])] };
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
      // Minted on request, by rotateWebhookSecret — see there.
      webhookSecret: '',
      autoUpdateStatus: dto.autoUpdateStatus ?? false,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateGitHubIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.repoOwner !== undefined) data.repoOwner = dto.repoOwner;
    if (dto.repoName !== undefined) data.repoName = dto.repoName;
    if (dto.accessToken !== undefined) data.accessToken = this.cipher.encrypt(dto.accessToken);
    if (dto.autoUpdateStatus !== undefined) data.autoUpdateStatus = dto.autoUpdateStatus;
    if (dto.enabledEvents !== undefined) data.enabledEvents = dto.enabledEvents as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }

  /**
   * Mint the secret GitHub signs its deliveries with, and hand it over — once.
   *
   * The receiver has always verified a signature against `webhookSecret`, and
   * refuses when that is empty. Nothing ever filled it: the form did not ask for
   * one and no route generated one, so every integration that was "connected"
   * turned away every push with a 401 and recorded nothing, for good.
   *
   * Generated here rather than typed in, so it is never guessable; stored
   * encrypted, like the access token; and returned by THIS response alone —
   * every read reports only `webhookConfigured`. Calling it again replaces the
   * secret, which is how a leaked one is retired.
   */
  async rotateWebhookSecret(user: User, id: string) {
    const secret = newWebhookSecret();
    const row = await this.updateRow(user, id, { webhookSecret: this.cipher.encrypt(secret) });
    return { ...row, webhookSecret: secret };
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
      webhookSecret: '',
      autoUpdateStatus: dto.autoUpdateStatus ?? false,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateGitLabIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.projectPath !== undefined) data.projectPath = dto.projectPath;
    if (dto.accessToken !== undefined) data.accessToken = this.cipher.encrypt(dto.accessToken);
    if (dto.autoUpdateStatus !== undefined) data.autoUpdateStatus = dto.autoUpdateStatus;
    if (dto.enabledEvents !== undefined) data.enabledEvents = dto.enabledEvents as Prisma.InputJsonValue;
    return this.updateRow(user, id, data);
  }

  /** The token GitLab sends with its deliveries. See the GitHub service. */
  async rotateWebhookSecret(user: User, id: string) {
    const secret = newWebhookSecret();
    const row = await this.updateRow(user, id, { webhookSecret: this.cipher.encrypt(secret) });
    return { ...row, webhookSecret: secret };
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
  /**
   * The server posts to this URL, so it is only ever stored if it is Discord's.
   * Checking it at test time alone left the row in place, and the worker — which
   * never ran the test — would post commit notices to wherever it pointed.
   */
  private assertDiscordUrl(webhookUrl: string): void {
    if (!isDiscordWebhookUrl(webhookUrl)) {
      throw new BadRequestException(
        'That is not a Discord webhook URL. Copy it from the channel’s Integrations > Webhooks settings in Discord.',
      );
    }
  }
  create(user: User, dto: CreateDiscordIntegrationDto) {
    this.assertDiscordUrl(dto.webhookUrl);
    return this.createRow(user, dto.projectId, {
      projectId: dto.projectId,
      webhookUrl: dto.webhookUrl,
      enabledEvents: (dto.enabledEvents ?? []) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateDiscordIntegrationDto) {
    const data: Record<string, unknown> = {};
    if (dto.webhookUrl !== undefined) {
      this.assertDiscordUrl(dto.webhookUrl);
      data.webhookUrl = dto.webhookUrl;
    }
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
  /**
   * `?taskId=` narrows to the commits that reference one task.
   *
   * `linkedTaskIds` is a JSON array, which the list grammar has no operator for,
   * so the only way to answer "which commits mention this task?" was to download
   * a project's whole history and search it in the browser. Nothing did, and the
   * commits the worker had so carefully linked were shown nowhere.
   */
  list(user: User, query: Record<string, string | string[] | undefined>) {
    const { taskId, ...rest } = query;
    return super.list(
      user,
      rest,
      typeof taskId === 'string' && taskId
        ? { linkedTaskIds: { array_contains: [taskId] } }
        : undefined,
    );
  }
}
