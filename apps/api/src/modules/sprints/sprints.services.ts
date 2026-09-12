import { BadRequestException, Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlanningEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Retrospective, Sprint, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
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
  protected readonly auditEntity = 'sprint';
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
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: Sprint) {
    return sprintResponse(row);
  }

  /** See the note above assertRangeOrdered. `excludeId` is the sprint being edited. */
  private async assertNoOtherActiveSprint(
    projectId: string,
    status: string | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (status !== 'ACTIVE') return;
    const clash = await this.prisma.sprint.findFirst({
      where: {
        projectId,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { name: true },
    });
    if (clash) {
      throw new BadRequestException(
        `"${clash.name}" is already the active sprint for this project. Complete it first.`,
      );
    }
  }
  async create(user: User, dto: CreateSprintDto) {
    const startDate = parseSprintDate(dto.startDate, 'startDate');
    const endDate = parseSprintDate(dto.endDate, 'endDate');
    assertRangeOrdered(startDate, endDate);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await this.assertNoOtherActiveSprint(dto.projectId, dto.status);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      name: dto.name,
      goal: dto.goal ?? '',
      startDate,
      endDate,
      status: dto.status ?? 'PLANNING',
      retrospectiveNotes: dto.retrospectiveNotes ?? '',
      createdById: user.id,
      createdByName: user.name ?? '',
    });
  }
  async patch(user: User, id: string, dto: UpdateSprintDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.goal !== undefined) data.goal = dto.goal;
    if (dto.startDate !== undefined) data.startDate = parseSprintDate(dto.startDate, 'startDate');
    if (dto.endDate !== undefined) data.endDate = parseSprintDate(dto.endDate, 'endDate');
    // Validate the MERGED range, not just the DTO. A patch carrying one date
    // short-circuited the guard and could land `endDate` before the sprint's
    // stored `startDate` — the exact negative span the check exists to reject,
    // reachable on PATCH while POST was protected.
    if (data.startDate !== undefined || data.endDate !== undefined) {
      const row = await this.findScoped(user, id);
      assertRangeOrdered(
        (data.startDate as Date | undefined) ?? row.startDate,
        (data.endDate as Date | undefined) ?? row.endDate,
      );
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.retrospectiveNotes !== undefined) data.retrospectiveNotes = dto.retrospectiveNotes;

    // `sprint.started` existed in the shared event contract but nothing ever
    // emitted it — starting a sprint is an ordinary PATCH, so the milestone was
    // invisible to the audit trail and to realtime while `sprint.completed`
    // (which has its own service) was not. Read the previous status first so the
    // event fires on the PLANNING -> ACTIVE transition only, never on a repeat
    // PATCH of an already-active sprint.
    const before = dto.status === 'ACTIVE' ? await this.findScoped(user, id) : null;
    const result = await this.update(user, id, data);
    if (before && before.status !== 'ACTIVE') {
      this.events.emit(PlanningEvents.SprintStarted, {
        name: PlanningEvents.SprintStarted,
        workspaceId: before.workspaceId,
        payload: {
          workspaceId: before.workspaceId,
          projectId: before.projectId,
          sprintId: id,
          actorId: user.id,
        },
        occurredAt: new Date().toISOString(),
      });
    }
    return result;
  }
}

/** `new Date('garbage')` is an Invalid Date, which Prisma rejects with an opaque
 *  driver error. Fail as a 400 with the offending field named instead. */
function parseSprintDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  return parsed;
}

/** end < start makes every downstream duration/burndown computation negative. */
/**
 * A project has at most one sprint in flight.
 *
 * Two ACTIVE sprints in one project made "the current sprint" ambiguous, and
 * every screen that resolves it picks the first row it happens to read — so the
 * board, the backlog and the analytics could each be describing a different
 * sprint at the same moment. `useActiveSprint` literally queries
 * `status=ACTIVE` with `limit(1)`.
 */
function assertRangeOrdered(startDate: Date, endDate: Date): void {
  if (endDate.getTime() < startDate.getTime()) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
}

@Injectable()
export class RetrospectivesService extends ScopedCrudService<
  Retrospective,
  ReturnType<typeof retrospectiveResponse>
> {
  protected readonly model = 'retrospective';
  protected readonly auditEntity = 'retrospective';
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
  async create(user: User, dto: CreateRetrospectiveDto) {
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await assertLinkInProject(this.prisma, 'sprint', 'Sprint', dto.sprintId, dto.projectId);
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
