import { ForbiddenException, Injectable } from '@nestjs/common';
import { generateId, parseListQuery, type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { ActivityLog, Prisma, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { activityLogResponse } from './mappers';

/** Entity types whose rows only the person and the approvers of that kind read. */
const LEAVE_ENTITIES = ['leave_request', 'leave_balance'];
const TIME_ENTITIES = ['time_entry'];

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
 * ActivityLog — the audit trail. Read here; written only by the server
 * (AuditSubscriber, audit-writer). UPDATE and DELETE are refused so history
 * stays immutable.
 */
@Injectable()
export class ActivityLogsService extends ScopedCrudService<
  ActivityLog,
  ReturnType<typeof activityLogResponse>
> {
  protected readonly model = 'activityLog';
  /** No route writes through this service; were one added, it would be an administrator's. */
  protected readonly writePermission: PermissionKey = Permission.WorkspaceUpdate;
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

  /**
   * Leave and time rows are the person's and their approvers' business.
   *
   * The trail is readable by every member, and the leave routes keep who asked
   * for what — and who was refused — to the person and whoever approves leave.
   * The trail undid that: "leave rejected" sat in every member's feed. A member
   * still reads every other row, and their own HR rows; an approver reads the
   * HR rows of the workspaces they approve in.
   */
  protected override async readScope(user: User): Promise<Record<string, unknown>> {
    const base = await super.readScope(user);
    if (this.access.isPlatformAdmin(user)) return base;
    const workspaceIds = (await this.access.accessibleWorkspaceIds(user)) ?? [];
    const approving = async (permission: PermissionKey) =>
      (
        await Promise.all(
          workspaceIds.map(async (id) => ((await this.access.can(user, id, permission)) ? id : null)),
        )
      ).filter((id): id is string => id !== null);
    const [leaveIn, timeIn] = await Promise.all([
      approving(Permission.LeaveApprove),
      approving(Permission.TimeApprove),
    ]);
    return {
      AND: [
        base,
        {
          OR: [
            { entityType: { notIn: [...LEAVE_ENTITIES, ...TIME_ENTITIES] } },
            { userId: user.id },
            { metadata: { path: ['subjectId'], equals: user.id } },
            { entityType: { in: LEAVE_ENTITIES }, workspaceId: { in: leaveIn } },
            { entityType: { in: TIME_ENTITIES }, workspaceId: { in: timeIn } },
          ],
        },
      ],
    };
  }

  /**
   * The distinct actions in the part of the trail the caller can read — the
   * activity feed's filter options.
   *
   * The feed reads the trail a page at a time and filters on the server, so it
   * can no longer offer "the actions among the rows on screen": that was only
   * ever the newest hundred, and an action older than them could not be picked
   * at all. Read exactly as `list` reads (the same read scope, the same
   * allowlisted filters), grouped instead of paged.
   */
  async actions(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<{ actions: string[] }> {
    const scope = await this.readScope(user);
    const { where } = parseListQuery(query, this.spec);
    const rows = await this.prisma.activityLog.groupBy({
      by: ['action'],
      where: { AND: [scope, where] } as Prisma.ActivityLogWhereInput,
      orderBy: { action: 'asc' },
    });
    return { actions: rows.map((row) => row.action) };
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
