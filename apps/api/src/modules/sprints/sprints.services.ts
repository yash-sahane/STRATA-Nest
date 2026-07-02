import { Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@lt/common';
import { PrismaService } from '@lt/prisma';
import type { Retrospective, Sprint, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  CreateRetrospectiveDto,
  CreateSprintDto,
  UpdateRetrospectiveDto,
  UpdateSprintDto,
} from './dto';
import { retrospectiveResponse, sprintResponse } from './mappers';

@Injectable()
export class SprintsService extends ScopedCrudService<Sprint, ReturnType<typeof sprintResponse>> {
  protected readonly model = 'sprint';
  protected readonly writePermission: PermissionKey = Permission.PlanningWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt', name: 'name', startDate: 'startDate' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Sprint) {
    return sprintResponse(row);
  }
  create(user: User, dto: CreateSprintDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      name: dto.name,
      goal: dto.goal ?? '',
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      status: dto.status ?? 'PLANNING',
      retrospectiveNotes: dto.retrospectiveNotes ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateSprintDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.goal !== undefined) data.goal = dto.goal;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.retrospectiveNotes !== undefined) data.retrospectiveNotes = dto.retrospectiveNotes;
    return this.update(user, id, data);
  }
}

@Injectable()
export class RetrospectivesService extends ScopedCrudService<
  Retrospective,
  ReturnType<typeof retrospectiveResponse>
> {
  protected readonly model = 'retrospective';
  protected readonly writePermission: PermissionKey = Permission.PlanningWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      sprintId: { field: 'sprintId' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Retrospective) {
    return retrospectiveResponse(row);
  }
  create(user: User, dto: CreateRetrospectiveDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      sprintId: dto.sprintId,
      wentWell: dto.wentWell ?? [],
      needsImprovement: dto.needsImprovement ?? [],
      actionItems: dto.actionItems ?? [],
      createdById: user.id,
    });
  }
  patch(user: User, id: string, dto: UpdateRetrospectiveDto) {
    const data: Record<string, unknown> = {};
    if (dto.wentWell !== undefined) data.wentWell = dto.wentWell;
    if (dto.needsImprovement !== undefined) data.needsImprovement = dto.needsImprovement;
    if (dto.actionItems !== undefined) data.actionItems = dto.actionItems;
    return this.update(user, id, data);
  }
}
