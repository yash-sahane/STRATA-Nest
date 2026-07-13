import { Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { ClientRequirement, FunctionalRequirement, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  CreateClientRequirementDto,
  CreateFunctionalRequirementDto,
  UpdateClientRequirementDto,
  UpdateFunctionalRequirementDto,
} from './dto';
import { clientRequirementResponse, functionalRequirementResponse } from './mappers';

@Injectable()
export class ClientRequirementsService extends ScopedCrudService<
  ClientRequirement,
  ReturnType<typeof clientRequirementResponse>
> {
  protected readonly model = 'clientRequirement';
  protected readonly writePermission: PermissionKey = Permission.RequirementWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
      priority: { field: 'priority' },
      clientName: { field: 'clientName' },
    },
    sortable: { createdAt: 'createdAt', title: 'title' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: ClientRequirement) {
    return clientRequirementResponse(row);
  }
  create(user: User, dto: CreateClientRequirementDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      title: dto.title,
      description: dto.description ?? '',
      clientName: dto.clientName ?? '',
      priority: dto.priority ?? 'MEDIUM',
      status: dto.status ?? 'DRAFT',
      attachments: dto.attachments ?? [],
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateClientRequirementDto) {
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.attachments !== undefined) data.attachments = dto.attachments;
    return this.update(user, id, data);
  }
}

@Injectable()
export class FunctionalRequirementsService extends ScopedCrudService<
  FunctionalRequirement,
  ReturnType<typeof functionalRequirementResponse>
> {
  protected readonly model = 'functionalRequirement';
  protected readonly writePermission: PermissionKey = Permission.RequirementWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      epicId: { field: 'epicId' },
      sprintId: { field: 'sprintId' },
      clientRequirementId: { field: 'clientRequirementId' },
      status: { field: 'status' },
      complexity: { field: 'complexity' },
      hierarchyId: { field: 'hierarchyId' },
      reusable: { field: 'reusable', type: 'boolean' },
    },
    sortable: { createdAt: 'createdAt', hierarchyId: 'hierarchyId' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: FunctionalRequirement) {
    return functionalRequirementResponse(row);
  }
  create(user: User, dto: CreateFunctionalRequirementDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      hierarchyId: dto.hierarchyId,
      epicId: dto.epicId ?? '',
      sprintId: dto.sprintId ?? '',
      clientRequirementId: dto.clientRequirementId ?? '',
      title: dto.title,
      description: dto.description ?? '',
      complexity: dto.complexity ?? 'MEDIUM',
      priority: dto.priority ?? '',
      status: dto.status ?? 'DRAFT',
      progress: dto.progress ?? 0,
      reusable: dto.reusable ?? false,
      assignedTo: dto.assignedTo ?? [],
      assignedToNames: dto.assignedToNames ?? [],
      tags: dto.tags ?? '',
      linkedProjectIds: dto.linkedProjectIds ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateFunctionalRequirementDto) {
    const data: Record<string, unknown> = {};
    for (const key of [
      'hierarchyId',
      'epicId',
      'sprintId',
      'clientRequirementId',
      'title',
      'description',
      'complexity',
      'priority',
      'status',
      'progress',
      'reusable',
      'assignedTo',
      'assignedToNames',
      'tags',
      'linkedProjectIds',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    return this.update(user, id, data);
  }
}
