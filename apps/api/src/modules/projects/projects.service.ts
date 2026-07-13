import { Injectable, NotFoundException } from '@nestjs/common';
import { generateId, paginate, parseListQuery, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, Project, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { CreateProjectDto, UpdateProjectDto } from './dto';
import { projectResponse } from './mappers';

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

  async create(user: User, dto: CreateProjectDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.ProjectCreate);
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
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        ownerId: user.id, // owner + createdBy stamped from the caller
        createdById: user.id,
        createdByName: user.name ?? '',
        memberIds: (dto.memberIds ?? []) as Prisma.InputJsonValue,
        projectSettings: (dto.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
    return projectResponse(project);
  }

  async update(user: User, id: string, dto: UpdateProjectDto) {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.ProjectUpdate);
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
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.memberIds !== undefined) data.memberIds = dto.memberIds as Prisma.InputJsonValue;
    if (dto.settings !== undefined) data.projectSettings = dto.settings as Prisma.InputJsonValue;
    const updated = await this.prisma.project.update({ where: { id }, data });
    return projectResponse(updated);
  }

  async remove(user: User, id: string): Promise<void> {
    const existing = await this.findScoped(user, id);
    await this.access.assertPermission(user, existing.workspaceId, Permission.ProjectDelete);
    await this.prisma.project.delete({ where: { id } });
  }
}
