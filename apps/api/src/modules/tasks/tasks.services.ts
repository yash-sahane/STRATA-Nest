import { Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { Label, Task, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type { CreateLabelDto, CreateTaskDto, UpdateLabelDto, UpdateTaskDto } from './dto';
import { labelResponse, taskResponse } from './mappers';

@Injectable()
export class TasksService extends ScopedCrudService<Task, ReturnType<typeof taskResponse>> {
  protected readonly model = 'task';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      sprintId: { field: 'sprintId' },
      epicId: { field: 'epicId' },
      functionalRequirementId: { field: 'functionalRequirementId' },
      parentTaskId: { field: 'parentTaskId' },
      status: { field: 'status' },
      priority: { field: 'priority' },
      hierarchyId: { field: 'hierarchyId' },
    },
    sortable: { createdAt: 'createdAt', position: 'position', hierarchyId: 'hierarchyId' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Task) {
    return taskResponse(row);
  }
  create(user: User, dto: CreateTaskDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      hierarchyId: dto.hierarchyId,
      sprintId: dto.sprintId ?? '',
      epicId: dto.epicId ?? '',
      functionalRequirementId: dto.functionalRequirementId ?? '',
      parentTaskId: dto.parentTaskId ?? '',
      title: dto.title,
      description: dto.description ?? '',
      status: dto.status ?? 'BACKLOG',
      priority: dto.priority ?? 'MEDIUM',
      assigneeIds: dto.assigneeIds ?? [],
      assignedBy: dto.assignedBy ?? '',
      assignedByName: dto.assignedByName ?? '',
      assignedTo: dto.assignedTo ?? [],
      assignedToNames: dto.assignedToNames ?? [],
      watcherIds: dto.watcherIds ?? [],
      createdById: user.id,
      createdByName: user.name ?? '',
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      estimatedHours: dto.estimatedHours ?? null,
      actualHours: dto.actualHours ?? null,
      labels: dto.labels ?? [],
      attachments: dto.attachments ?? [],
      customFields: dto.customFields ?? {},
      position: dto.position ?? 0,
      blockedBy: dto.blockedBy ?? [],
      blocks: dto.blocks ?? [],
    });
  }
  patch(user: User, id: string, dto: UpdateTaskDto) {
    const data: Record<string, unknown> = {};
    const copy = [
      'hierarchyId', 'title', 'sprintId', 'epicId', 'functionalRequirementId', 'parentTaskId',
      'description', 'status', 'priority', 'assigneeIds', 'assignedBy', 'assignedByName',
      'assignedTo', 'assignedToNames', 'watcherIds', 'estimatedHours', 'actualHours', 'labels',
      'attachments', 'customFields', 'position', 'blockedBy', 'blocks',
    ] as const;
    for (const k of copy) if (dto[k] !== undefined) data[k] = dto[k];
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    return this.update(user, id, data);
  }
}

@Injectable()
export class LabelsService extends ScopedCrudService<Label, ReturnType<typeof labelResponse>> {
  protected readonly model = 'label';
  protected readonly writePermission: PermissionKey = Permission.TaskWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      name: { field: 'name' },
    },
    sortable: { createdAt: 'createdAt', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Label) {
    return labelResponse(row);
  }
  create(user: User, dto: CreateLabelDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId ?? null,
      name: dto.name,
      color: dto.color,
      description: dto.description ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateLabelDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.description !== undefined) data.description = dto.description;
    return this.update(user, id, data);
  }
}
