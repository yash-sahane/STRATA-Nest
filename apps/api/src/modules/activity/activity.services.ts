import { ForbiddenException, Injectable } from '@nestjs/common';
import { generateId, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { ActivityLog, Prisma, SavedSearch, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type { CreateActivityLogDto, CreateSavedSearchDto, UpdateSavedSearchDto } from './dto';
import { activityLogResponse, savedSearchResponse } from './mappers';

/** Fields the server/subscriber supplies to append an audit row. */
export interface AuditInput {
  workspaceId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * ActivityLog — **append-only** audit trail. Supports list/create/retrieve but
 * rejects UPDATE and DELETE so history stays immutable. Server-written via
 * AuditSubscriber; client POSTs are also accepted directly.
 */
@Injectable()
export class ActivityLogsService extends ScopedCrudService<
  ActivityLog,
  ReturnType<typeof activityLogResponse>
> {
  protected readonly model = 'activityLog';
  protected readonly writePermission: PermissionKey = Permission.ActivityWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      action: { field: 'action' },
      entityType: { field: 'entityType' },
      entityId: { field: 'entityId' },
    },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: ActivityLog) {
    return activityLogResponse(row);
  }

  create(user: User, dto: CreateActivityLogDto) {
    // userId is stamped from the caller.
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      action: dto.action,
      entityType: dto.entityType,
      entityId: dto.entityId,
      changes: (dto.changes ?? {}) as Prisma.InputJsonValue,
      metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
    });
  }

  /** Append-only: the audit trail must never be mutated. */
  update(): never {
    throw new ForbiddenException('Activity log is append-only');
  }
  remove(): never {
    throw new ForbiddenException('Activity log is append-only');
  }

  /** Server-side audit append used by AuditSubscriber. */
  async record(input: AuditInput): Promise<void> {
    await this.prisma.activityLog.create({
      data: {
        id: generateId(),
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        changes: (input.changes ?? {}) as Prisma.InputJsonValue,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * SavedSearch — a PERSONAL collection: `create` always stamps the caller as
 * owner and nothing in the product shares a saved search with anyone else.
 */
@Injectable()
export class SavedSearchesService extends ScopedCrudService<
  SavedSearch,
  ReturnType<typeof savedSearchResponse>
> {
  protected readonly model = 'savedSearch';
  protected readonly writePermission: PermissionKey = Permission.ActivityWrite;
  /**
   * Row-level owner guard. `writePermission` alone cannot protect these rows:
   * ActivityWrite is part of the READ_ONLY member baseline (permissions.ts),
   * which every member holds so they can save their own searches — so without
   * this, any member could PATCH or DELETE a colleague's saved search. There is
   * deliberately no `ownerOverridePermission`: nobody manages another user's
   * saved searches.
   */
  protected readonly ownerField = 'userId';
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt', name: 'name' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: SavedSearch) {
    return savedSearchResponse(row);
  }
  create(user: User, dto: CreateSavedSearchDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      name: dto.name,
      query: dto.query,
      filters: (dto.filters ?? {}) as Prisma.InputJsonValue,
    });
  }
  patch(user: User, id: string, dto: UpdateSavedSearchDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.query !== undefined) data.query = dto.query;
    if (dto.filters !== undefined) data.filters = dto.filters as Prisma.InputJsonValue;
    return this.update(user, id, data);
  }
}
