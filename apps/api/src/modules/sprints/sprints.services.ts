import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PlanningEvents } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Sprint, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type { CreateSprintDto, UpdateSprintDto } from './dto';
import { sprintResponse } from './mappers';

@Injectable()
export class SprintsService extends ScopedCrudService<Sprint, ReturnType<typeof sprintResponse>> {
  protected readonly model = 'sprint';
  /** Carries a `version` column, so a stale save is refused rather than applied. */
  protected override readonly versioned = true;
  protected readonly auditEntity = 'sprint';
  protected readonly writePermission: PermissionKey = Permission.PlanningWrite;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      projectId: { field: 'projectId' },
      status: { field: 'status' },
    },
    sortable: { createdAt: 'createdAt', name: 'name', startDate: 'startDate' },
    search: ['name', 'goal'],
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

  private readonly logger = new Logger('Sprints');

  /** Run an event's subscribers to completion. The sprint is already saved, so
   *  a subscriber that fails is logged rather than turned into a failed request. */
  private async settle(name: string, event: object): Promise<void> {
    try {
      await this.events.emitAsync(name, event);
    } catch (err) {
      this.logger.warn(`${name} subscriber failed: ${(err as Error).message}`);
    }
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
  /**
   * The status changes a PATCH may make.
   *
   * Starting a sprint IS a patch, and the one-active-sprint rule above was only
   * ever applied on create — where the UI always sends PLANNING — so a second
   * sprint could be started beside a running one and "the current sprint"
   * stopped having an answer.
   *
   * Closing a sprint is NOT a patch: POST /sprints/:id/complete records what
   * was finished, returns the unfinished work to the backlog and announces it.
   * Setting COMPLETED here skipped all three, leaving a "completed" sprint with
   * no results and its open tasks stuck inside it. And a completed sprint stays
   * completed: its recorded figures describe the moment it closed, which
   * reopening would quietly turn into fiction.
   */
  private async assertTransition(sprint: Sprint, next: string): Promise<void> {
    if (sprint.status === 'COMPLETED') {
      throw new BadRequestException('A completed sprint cannot be reopened.');
    }
    if (next === 'COMPLETED') {
      throw new BadRequestException(
        'Use "Complete Sprint" to close a sprint, so its results are recorded and unfinished work goes back to the backlog.',
      );
    }
    await this.assertNoOtherActiveSprint(sprint.projectId, next, sprint.id);
  }

  /**
   * Start a sprint — one start per project at a time.
   *
   * The one-active check reads and the write lands afterwards, so two starts at
   * once (two sprints of a project, or two managers) each read "nothing is
   * running" and BOTH went ACTIVE. A transaction-scoped advisory lock per
   * project makes them queue, the way leave requests do: the check runs again
   * inside it, and the write is awaited inside it, so it has committed before
   * the next start in the queue looks. That one is refused — or, when it was
   * the same sprint, finds it already running and does not announce the start a
   * second time.
   */
  private async startUnderLock(
    user: User,
    sprint: Sprint,
    data: Record<string, unknown>,
    basedOn?: Record<string, unknown>,
  ): Promise<{ result: ReturnType<typeof sprintResponse>; started: boolean }> {
    const lockKey = `sprint-start:${sprint.projectId}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      const current = await this.findScoped(user, sprint.id);
      const started = current.status !== 'ACTIVE';
      if (started) await this.assertTransition(current, 'ACTIVE');
      return { result: await this.update(user, sprint.id, data, basedOn), started };
    });
  }

  async create(user: User, dto: CreateSprintDto) {
    // A sprint is created in Planning and started by a PATCH. Created ACTIVE it
    // skipped everything a start does — the one-active check under the start's
    // lock (so two could race into existence), its Backlog tasks moving onto the
    // board, the project turning Active, the "started" announcement — and
    // created COMPLETED it was the record of a sprint that never ran.
    if (dto.status !== undefined && dto.status !== 'PLANNING') {
      throw new BadRequestException(
        'A sprint is created in Planning. Create it, then start it from the sprint page.',
      );
    }
    const startDate = parseSprintDate(dto.startDate, 'startDate');
    const endDate = parseSprintDate(dto.endDate, 'endDate');
    assertRangeOrdered(startDate, endDate);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      projectId: dto.projectId,
      name: dto.name,
      goal: dto.goal ?? '',
      startDate,
      endDate,
      status: 'PLANNING',
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
    // The sprint as it stands, read only for a patch that names a status.
    const before = dto.status !== undefined ? await this.findScoped(user, id) : null;
    const closed = (before ?? (await this.findScoped(user, id))).status === 'COMPLETED';
    if (closed) {
      const fixed = Object.keys(data).filter((field) => field !== 'name' && field !== 'retrospectiveNotes');
      if (fixed.length > 0 && !(fixed.length === 1 && fixed[0] === 'status' && data.status === 'COMPLETED')) {
        throw new BadRequestException(
          "A completed sprint's goal and dates are its record, and it stays completed. Only its name and retrospective can change.",
        );
      }
    }
    if (before && dto.status !== undefined && dto.status !== before.status) {
      await this.assertTransition(before, dto.status);
    }
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.retrospectiveNotes !== undefined) data.retrospectiveNotes = dto.retrospectiveNotes;

    // `sprint.started` existed in the shared event contract but nothing ever
    // emitted it — starting a sprint is an ordinary PATCH, so the milestone was
    // invisible to the audit trail and to realtime while `sprint.completed`
    // (which has its own service) was not. It fires on the PLANNING -> ACTIVE
    // transition only, never on a repeat PATCH of an already-active sprint.
    const { result, started } =
      before && dto.status === 'ACTIVE' && before.status !== 'ACTIVE'
        ? await this.startUnderLock(user, before, data, dto.basedOn)
        : { result: await this.update(user, id, data, dto.basedOn), started: false };
    if (before && started) {
      // AWAITED: starting a sprint also moves its Backlog tasks to To Do (a
      // subscriber to this event), and the caller refetches the board the moment
      // this returns. Fired and forgotten, that refetch could land first and
      // show a started sprint whose tasks had not moved.
      await this.settle(PlanningEvents.SprintStarted, {
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
      // Work has started: a project still in Planning is Active from now on.
      // Conditional, so a project somebody put On Hold or Completed by hand
      // keeps what they said.
      const moved = await this.prisma.project.updateMany({
        where: { id: before.projectId, status: 'PLANNING' },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      if (moved.count > 0) {
        const project = await this.prisma.project.findUnique({ where: { id: before.projectId } });
        if (project) this.prisma.announceWrite?.('Project', 'update', project);
      }
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
 * sprint at the same moment.
 */
function assertRangeOrdered(startDate: Date, endDate: Date): void {
  if (endDate.getTime() < startDate.getTime()) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
}
