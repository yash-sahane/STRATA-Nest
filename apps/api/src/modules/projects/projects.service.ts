import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  generateId,
  paginate,
  parseListQuery,
  sameFieldValue,
  toDate,
  type ListQuerySpec,
} from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, Project, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { writeAuditRow } from '../activity/audit-writer';
import {
  changedWhileEditing,
  CHANGED_WHILE_EDITING_TYPE,
  DELETED_WHILE_EDITING,
  DELETED_WHILE_EDITING_TYPE,
} from '../workspaces/scoped-crud.base';
import type { CreateProjectDto, UpdateProjectDto } from './dto';
import { projectResponse } from './mappers';

/**
 * A project that ends before it starts makes every timeline, burndown and
 * "days remaining" figure it feeds negative. The clients guard the pair only
 * when BOTH dates sit on the same form — the settings page skipped the check
 * whenever one of them had just been cleared — so the ordering has to be
 * settled here, on the merged range, the way sprints already do it.
 */
function assertRangeOrdered(startDate: Date | null, endDate: Date | null): void {
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
}

const SPEC: ListQuerySpec = {
  filterable: {
    workspaceId: { field: 'workspaceId' },
    status: { field: 'status' },
    archived: { field: 'archived', type: 'boolean' },
    ownerId: { field: 'ownerId' },
    methodology: { field: 'methodology' },
    shortCode: { field: 'shortCode' },
  },
  sortable: { createdAt: 'createdAt', name: 'name', status: 'status' },
  defaultOrderBy: { createdAt: 'desc' },
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof projectResponse>>> {
    const scope = await this.access.scopeWhere(user);
    const parsed = parseListQuery(query, SPEC);
    const where: Prisma.ProjectWhereInput = {
      AND: [scope, parsed.where as Prisma.ProjectWhereInput],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.ProjectOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.project.count({ where }),
    ]);
    return paginate(items.map(projectResponse), total, parsed.page, parsed.pageSize);
  }

  private async findScoped(user: User, id: string): Promise<Project> {
    const scope = await this.access.scopeWhere(user);
    const project = await this.prisma.project.findFirst({ where: { AND: [scope, { id }] } });
    if (!project) throw new NotFoundException('Not found.');
    return project;
  }

  async retrieve(user: User, id: string) {
    return projectResponse(await this.findScoped(user, id));
  }

  /**
   * `shortCode` prefixes every task hierarchy id in the project, so two projects
   * sharing one inside a workspace make those ids ambiguous — and the clone flow
   * rewrites the prefix by string replacement, which silently no-ops when the
   * clone derives the source's code. Clients derive the code from the name
   * ("Mobile App" and "Mobile Alpha" both give "MOA"), so the collision is
   * routine and has to be rejected here rather than trusted from the caller.
   */
  private async assertShortCodeFree(
    workspaceId: string,
    shortCode: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.project.findFirst({
      where: {
        workspaceId,
        shortCode,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `Project code "${shortCode}" is already used by another project in this workspace.`,
      );
    }
  }

  async create(user: User, dto: CreateProjectDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.ProjectCreate);
    await this.assertShortCodeFree(dto.workspaceId, dto.shortCode);
    const startDate = toDate(dto.startDate, 'Start date');
    const endDate = toDate(dto.endDate, 'End date');
    assertRangeOrdered(startDate, endDate);
    const project = await this.prisma.project.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        name: dto.name,
        shortCode: dto.shortCode,
        description: dto.description ?? '',
        clientName: dto.clientName ?? '',
        logo: dto.logo ?? '',
        color: dto.color ?? '',
        methodology: dto.methodology ?? 'SCRUM',
        status: dto.status ?? 'PLANNING',
        archived: dto.archived ?? false,
        startDate,
        endDate,
        ownerId: user.id, // owner + createdBy stamped from the caller
        createdById: user.id,
        createdByName: user.name ?? '',
        memberIds: (dto.memberIds ?? []) as Prisma.InputJsonValue,
        projectSettings: (dto.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.audit(user, project.workspaceId, 'created', project.id, project);
    return projectResponse(project);
  }

  async update(user: User, id: string, dto: UpdateProjectDto) {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.ProjectUpdate);
    if (dto.shortCode !== undefined && dto.shortCode !== existing.shortCode) {
      await this.assertShortCodeFree(existing.workspaceId, dto.shortCode, existing.id);
    }
    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortCode !== undefined) data.shortCode = dto.shortCode;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.logo !== undefined) data.logo = dto.logo;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.methodology !== undefined) data.methodology = dto.methodology;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.archived !== undefined) data.archived = dto.archived;
    // Resolve against the STORED row, and read "cleared" (null) apart from
    // "untouched" (absent) — `?? existing` would quietly restore a date the
    // caller just removed, and validating the DTO alone lets a one-sided patch
    // slip an inverted range past the check.
    const startDate =
      dto.startDate !== undefined ? toDate(dto.startDate, 'Start date') : existing.startDate;
    const endDate = dto.endDate !== undefined ? toDate(dto.endDate, 'End date') : existing.endDate;
    assertRangeOrdered(startDate, endDate);
    if (dto.startDate !== undefined) data.startDate = startDate;
    if (dto.endDate !== undefined) data.endDate = endDate;
    if (dto.memberIds !== undefined) data.memberIds = dto.memberIds as Prisma.InputJsonValue;
    if (dto.settings !== undefined) data.projectSettings = dto.settings as Prisma.InputJsonValue;
    const updated = await this.writeUpdate(existing, id, data, dto.basedOn);
    await this.audit(user, updated.workspaceId, 'updated', id, updated, Object.keys(data));
    return projectResponse(updated);
  }

  async remove(user: User, id: string): Promise<void> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.ProjectDelete);
    await this.prisma.project.delete({ where: { id } });
    await this.audit(user, existing.workspaceId, 'deleted', id, existing);
  }

  /**
   * The write, with the lost-update guard ScopedCrudService applies to the other four
   * versioned collections. Projects predate that base and own their CRUD, so the rule is
   * spelled out here rather than inherited — deliberately the same behaviour and the same
   * messages, so nobody can tell from the wording which screen they hit it on.
   *
   * The counter moves on every edit, including one that sent no `basedOn`: a save from an
   * older client has to be visible to a newer one, or the overwrite this exists to catch
   * is the one it cannot see.
   *
   * `basedOn` is compared against the RESPONSE shape, which is where the client got those
   * values — `startDate` is `yyyy-MM-dd` there and a full instant in the row, and
   * `settings` is stored as `projectSettings`.
   */
  private async writeUpdate(
    existing: Project,
    id: string,
    data: Prisma.ProjectUpdateInput,
    basedOn?: Record<string, unknown>,
  ): Promise<Project> {
    const withBump = { ...data, version: { increment: 1 } };
    if (basedOn === undefined) {
      return this.prisma.project.update({ where: { id }, data: withBump });
    }
    // Only the fields this save is actually writing, so an edit to the name is never
    // refused because somebody changed the status.
    const written = new Set(Object.keys(data));
    const writtenAs: Record<string, string> = { projectSettings: 'settings' };
    const submitted = new Set([...written].map((k) => writtenAs[k] ?? k));

    let current: Project | null = existing;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!current) {
        throw new NotFoundException({
          message: DELETED_WHILE_EDITING,
          type: DELETED_WHILE_EDITING_TYPE,
        });
      }
      const rendered = projectResponse(current) as unknown as Record<string, unknown>;
      const clashing = Object.keys(basedOn).filter(
        (field) => submitted.has(field) && !sameFieldValue(rendered[field], basedOn[field]),
      );
      if (clashing.length > 0) {
        throw new ConflictException({
          message: changedWhileEditing(clashing),
          type: CHANGED_WHILE_EDITING_TYPE,
          fields: clashing,
        });
      }
      // `updateMany`, because `update` accepts only unique columns in `where` and the
      // condition that matters here is on a non-unique one. A zero count means somebody
      // wrote between the read above and this write, so look again rather than refuse.
      const { count } = await this.prisma.project.updateMany({
        where: { id, version: current.version },
        data: withBump as Prisma.ProjectUpdateManyMutationInput,
      });
      current = await this.prisma.project.findUnique({ where: { id } });
      if (count === 1) return current as Project;
    }
    throw new ConflictException({
      message:
        'This project is being changed by several people at once, so your save could not ' +
        'be applied. Reload and try again.',
      type: CHANGED_WHILE_EDITING_TYPE,
      fields: [],
    });
  }

  /** Projects predate ScopedCrudService and own their CRUD, so the audit row is
   *  appended here rather than inherited. */
  private audit(
    user: User,
    workspaceId: string,
    action: 'created' | 'updated' | 'deleted',
    entityId: string,
    row: Project,
    changedFields?: string[],
  ): Promise<void> {
    return writeAuditRow(this.prisma, {
      workspaceId,
      userId: user.id,
      entity: 'project',
      action,
      entityId,
      row: row as unknown as Record<string, unknown>,
      changedFields,
    });
  }
}
