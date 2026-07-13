import { Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Epic, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type { CreateEpicDto, UpdateEpicDto } from './dto';
import { epicResponse } from './mappers';

@Injectable()
export class EpicsService extends ScopedCrudService<Epic, ReturnType<typeof epicResponse>> {
  protected readonly model = 'epic';
  protected readonly writePermission: PermissionKey = Permission.PlanningWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
      requirementId: { field: 'requirementId' },
      hierarchyId: { field: 'hierarchyId' },
    },
    sortable: { createdAt: 'createdAt', hierarchyId: 'hierarchyId', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Epic) {
    return epicResponse(row);
  }
  create(user: User, dto: CreateEpicDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      requirementId: dto.requirementId ?? '',
      hierarchyId: dto.hierarchyId,
      name: dto.name,
      description: dto.description ?? '',
      color: dto.color ?? '',
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      endDate: dto.endDate ? new Date(dto.endDate) : null,
      status: dto.status ?? 'TODO',
      progress: dto.progress ?? 0,
      assignedTeam: dto.assignedTeam ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateEpicDto) {
    const data: Record<string, unknown> = {};
    if (dto.hierarchyId !== undefined) data.hierarchyId = dto.hierarchyId;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.requirementId !== undefined) data.requirementId = dto.requirementId;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.progress !== undefined) data.progress = dto.progress;
    if (dto.assignedTeam !== undefined) data.assignedTeam = dto.assignedTeam;
    return this.update(user, id, data);
  }
}
