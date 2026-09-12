import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate, parseListQuery, generateId, type ListQuerySpec, toRequiredDate } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Prisma, TimeEntry, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import type {
  CreateActiveTimerDto,
  CreateTimeEntryDto,
  UpdateActiveTimerDto,
  UpdateTimeEntryDto,
} from './dto';
import { activeTimerResponse, timeEntryResponse } from './mappers';

/** One logged entry covers at most a day; longer means split it. */
const MAX_ENTRY_MINUTES = 24 * 60;
/**
 * The shortest window worth a row. `duration` is whole minutes, so anything
 * that rounds below one is stored as 0 and renders as "0m" — a total nobody can
 * read and, worse, an approval an approver cannot meaningfully decide. Shared
 * with the timer stop path, which discards such a run instead of writing it.
 */
export const MIN_ENTRY_MINUTES = 1;
/** Clock skew a client is allowed when it says "just now". */
const FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Validate a logged window and return the ONLY duration the row may carry.
 *
 * Nothing here was checked before: reversed ranges, zero-length entries,
 * negative durations, a 90-minute window claiming 100000 minutes, a decade-long
 * entry and work booked in 2031 were all stored verbatim and counted towards
 * the member's total, the billing figures and the manager's approval queue.
 * A window shorter than half a minute rounded to 0 and slipped through the same
 * way, so it is refused here rather than filed as a "0m" entry to approve.
 */
function loggedMinutes(startTime: Date, endTime: Date): number {
  if (endTime.getTime() <= startTime.getTime()) {
    throw new BadRequestException('End time must be after the start time.');
  }
  if (startTime.getTime() > Date.now() + FUTURE_SKEW_MS) {
    throw new BadRequestException('Time cannot be logged for work that has not happened yet.');
  }
  const minutes = Math.round((endTime.getTime() - startTime.getTime()) / 60_000);
  if (minutes < MIN_ENTRY_MINUTES) {
    throw new BadRequestException('A time entry must cover at least a minute.');
  }
  if (minutes > MAX_ENTRY_MINUTES) {
    throw new BadRequestException('A single entry cannot cover more than 24 hours — split it by day.');
  }
  return minutes;
}

/**
 * The one place that decides what rate a row is allowed to carry.
 *
 * A rate only means anything on a BILLABLE entry. An entry switched to
 * non-billable kept its old rate, so it still multiplied out wherever billing
 * is computed and the edit dialog handed the stale number straight back the
 * moment the toggle went on again. `null` is the cleared state; `undefined`
 * from a client means "not being changed" and is resolved by the caller before
 * it gets here.
 */
export function resolveBillableRate(
  isBillable: boolean,
  rate: number | null | undefined,
): number | null {
  return isBillable ? (rate ?? null) : null;
}

@Injectable()
export class TimeEntriesService extends ScopedCrudService<
  TimeEntry,
  ReturnType<typeof timeEntryResponse>
> {
  protected readonly model = 'timeEntry';
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  // Personal records: HrWrite is in the member baseline, so only the owner (or a
  // time approver) may edit/delete an entry.
  protected readonly ownerField = 'userId';
  protected readonly ownerOverridePermission: PermissionKey = Permission.TimeApprove;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      taskId: { field: 'taskId' },
      projectId: { field: 'projectId' },
      type: { field: 'type' },
      startTime: { field: 'startTime', type: 'date' },
      endTime: { field: 'endTime', type: 'date' },
    },
    sortable: { createdAt: 'createdAt', startTime: 'startTime' },
    defaultOrderBy: { startTime: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: TimeEntry) {
    return timeEntryResponse(row);
  }
  async create(user: User, dto: CreateTimeEntryDto) {
    const startTime = toRequiredDate(dto.startTime, 'Start time');
    const endTime = toRequiredDate(dto.endTime, 'End time');
    const duration = loggedMinutes(startTime, endTime);
    await assertProjectInWorkspace(this.prisma, dto.projectId, dto.workspaceId);
    await assertLinkInProject(this.prisma, 'task', 'Task', dto.taskId, dto.projectId ?? '');
    // userId/userName/userEmail/createdById are stamped from the caller.
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      createdById: user.id,
      createdByName: user.name ?? '',
      taskId: dto.taskId ?? '',
      taskTitle: dto.taskTitle ?? '',
      taskHierarchyId: dto.taskHierarchyId ?? '',
      projectId: dto.projectId ?? '',
      projectName: dto.projectName ?? '',
      description: dto.description ?? '',
      startTime,
      endTime,
      duration,
      isBillable: dto.isBillable ?? false,
      billableRate: resolveBillableRate(dto.isBillable ?? false, dto.billableRate),
      type: dto.type ?? 'MANUAL',
      status: 'PENDING',
      tags: dto.tags ?? [],
    });
  }
  async patch(user: User, id: string, dto: UpdateTimeEntryDto) {
    const data: Record<string, unknown> = {};
    if (dto.startTime !== undefined) data.startTime = toRequiredDate(dto.startTime, 'Start time');
    if (dto.endTime !== undefined) data.endTime = toRequiredDate(dto.endTime, 'End time');
    // dto.duration is deliberately not copied — see the DTO.
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
    if (dto.tags !== undefined) data.tags = dto.tags;
    // The rate is settled below, against the row, so that switching an entry to
    // non-billable drops the rate with it. A body carrying nothing BUT a rate
    // still has work to do, so it must not fall into the no-op below.
    const touchesRate = dto.isBillable !== undefined || dto.billableRate !== undefined;
    if (Object.keys(data).length === 0 && !touchesRate) return this.retrieve(user, id);
    /**
     * An entry that has been decided cannot be quietly rewritten UNDER the
     * decision. The owner could edit an approved entry's hours and description
     * while status/approvedBy/approvedAt stayed put, so the manager's approval
     * went on vouching for figures they never saw. Editing re-opens it: the
     * decision is cleared and the entry goes back in the queue, which keeps the
     * entry correctable without ever letting an approval outlive its numbers.
     */
    const row = await this.findScoped(user, id);
    // Recompute from the pair the row will END UP with, so moving one end of the
    // window can never leave the stored duration describing the old one.
    if (data.startTime !== undefined || data.endTime !== undefined) {
      data.duration = loggedMinutes(
        (data.startTime as Date | undefined) ?? row.startTime,
        (data.endTime as Date | undefined) ?? row.endTime,
      );
    }
    if (touchesRate) {
      // Resolved from the pair the row will END UP with: `null` clears the rate,
      // an absent key keeps the stored one, and either way a non-billable entry
      // is left with no rate at all.
      data.billableRate = resolveBillableRate(
        (data.isBillable as boolean | undefined) ?? row.isBillable,
        dto.billableRate !== undefined ? dto.billableRate : row.billableRate,
      );
    }
    if (row.status === 'APPROVED' || row.status === 'REJECTED') {
      data.status = 'PENDING';
      data.approvedBy = '';
      data.approvedAt = null;
      data.rejectionReason = '';
    }
    return this.update(user, id, data);
  }
}

/**
 * ActiveTimer has no workspace column; it is tied to a single user
 * (`user_id` is UNIQUE). Every read/write is therefore scoped to the caller's
 * own timer — a user can only ever see or mutate their own, never another
 * user's by id.
 */
@Injectable()
export class ActiveTimersService {
  private readonly spec: ListQuerySpec = {
    filterable: { userId: { field: 'userId' } },
    sortable: { createdAt: 'createdAt' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof activeTimerResponse>>> {
    const parsed = parseListQuery(query, this.spec);
    // Force the caller's own scope — never trust a client-supplied userId filter.
    const where = { ...(parsed.where as Prisma.ActiveTimerWhereInput), userId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.activeTimer.findMany({
        where,
        orderBy: parsed.orderBy as Prisma.ActiveTimerOrderByWithRelationInput[],
        skip: parsed.skip,
        take: parsed.take,
      }),
      this.prisma.activeTimer.count({ where }),
    ]);
    return paginate(items.map(activeTimerResponse), total, parsed.page, parsed.pageSize);
  }

  async retrieve(user: User, id: string) {
    const t = await this.prisma.activeTimer.findUnique({ where: { id } });
    if (!t || t.userId !== user.id) throw new NotFoundException('Not found.');
    return activeTimerResponse(t);
  }

  async create(user: User, dto: CreateActiveTimerDto) {
    const t = await this.prisma.activeTimer.create({
      data: {
        id: generateId(),
        userId: user.id,
        // The SERVER's clock, never the client's. POST /active_timers accepted a
        // startTime, so posting one dated 2020 and immediately stopping the
        // timer minted a 58,545-hour entry sitting in the manager's approval
        // queue one click from being signed off. TimerService.start already
        // stamped it here; this path did not.
        startTime: new Date(),
        taskId: dto.taskId ?? '',
        taskTitle: dto.taskTitle ?? '',
        taskHierarchyId: dto.taskHierarchyId ?? '',
        projectId: dto.projectId ?? '',
        description: dto.description ?? '',
        type: dto.type ?? 'TIMER',
        pomodoroSettings: (dto.pomodoroSettings ?? null) as Prisma.InputJsonValue,
      },
    });
    return activeTimerResponse(t);
  }

  async update(user: User, id: string, dto: UpdateActiveTimerDto): Promise<ReturnType<typeof activeTimerResponse>> {
    await this.ensureOwned(user, id);
    const data: Prisma.ActiveTimerUpdateInput = {};
    if (dto.isPaused !== undefined) data.isPaused = dto.isPaused;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.pomodoroSettings !== undefined) {
      data.pomodoroSettings = dto.pomodoroSettings as Prisma.InputJsonValue;
    }
    return activeTimerResponse(await this.prisma.activeTimer.update({ where: { id }, data }));
  }

  async remove(user: User, id: string): Promise<void> {
    await this.ensureOwned(user, id);
    await this.prisma.activeTimer.delete({ where: { id } });
  }

  /** Assert the timer exists AND belongs to the caller (else 404 — no cross-user access). */
  private async ensureOwned(user: User, id: string): Promise<void> {
    const row = await this.prisma.activeTimer.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!row || row.userId !== user.id) throw new NotFoundException('Not found.');
  }

  private timerOf(userId: string) {
    return this.prisma.activeTimer.findUnique({ where: { userId } });
  }
  timerForUser(userId: string): ReturnType<ActiveTimersService['timerOf']> {
    return this.timerOf(userId);
  }
}
