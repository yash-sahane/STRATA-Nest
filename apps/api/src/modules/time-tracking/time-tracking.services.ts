import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  generateId,
  paginate,
  parseListQuery,
  pinScopeParam,
  type ListQuerySpec,
  toRequiredDate,
} from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { ActiveTimer, Prisma, TimeEntry, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { CHANGED_WHILE_EDITING_TYPE, ScopedCrudService } from '../workspaces/scoped-crud.base';
import { assertLinkInProject, assertProjectInWorkspace } from '../workspaces/workspace-refs';
import { assertProjectWritable } from '../projects/project-archive';
import type {
  CreateTimeEntryDto,
  UpdateTimeEntryDto,
} from './dto';
import { activeTimerResponse, timeEntryResponse } from './mappers';
import { tellPeople } from '../notifications/notice';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * One logged entry covers at most a day; longer means split it. Shared with the
 * timer, whose run is filed under the same rule rather than as whatever a
 * forgotten weekend added up to.
 */
export const MAX_ENTRY_MINUTES = 24 * 60;
/**
 * The shortest window worth a row. `duration` is whole minutes, so anything
 * that rounds below one is stored as 0 and renders as "0m" — a total nobody can
 * read and, worse, an approval an approver cannot meaningfully decide. Shared
 * with the timer stop path, which discards such a run instead of writing it.
 */
export const MIN_ENTRY_MINUTES = 1;
/** Clock skew a client is allowed when it says "just now". */
export const FUTURE_SKEW_MS = 5 * 60_000;

/** "64h 12m", for a message a person reads. */
export function minutesInWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

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
  // The END as well. Only the start was checked, so an entry begun an hour ago
  // could run on into tomorrow: "today 09:00 to 17:00" typed in at lunchtime
  // went to the approver as eight hours worked, five of them still to come.
  if (endTime.getTime() > Date.now() + FUTURE_SKEW_MS) {
    throw new BadRequestException(
      'An entry cannot end in the future. Log the time once it has been worked.',
    );
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

/** An entry as the overlap rule needs to see it. */
type LoggedWindow = Pick<TimeEntry, 'startTime' | 'endTime' | 'duration'>;

/**
 * Whether a new window lands on time an existing entry records as worked.
 *
 * An entry from a timer that was paused covers a window longer than the time it
 * records, and where in that window the pause fell is not stored — so the
 * window alone cannot say whether a new entry sits on worked time or in the
 * gap. What it can say is that the overlap is larger than the gap could hold.
 * That is the clash: any overlap at all with an entry that has no gap, overlap
 * beyond the gap with one that has. Measured in whole minutes, so a timer
 * stopped at 11:00:20 and an entry typed in from 11:00 touch rather than clash.
 *
 * The time-entry dialog mirrors this rule (manual-time-entry-dialog.tsx) so the
 * refusal is seen before Save; the two have to agree about what counts.
 */
export function overlapsWorkedTime(existing: LoggedWindow, startTime: Date, endTime: Date): boolean {
  const overlapMs =
    Math.min(existing.endTime.getTime(), endTime.getTime()) -
    Math.max(existing.startTime.getTime(), startTime.getTime());
  if (overlapMs <= 0) return false;
  const windowMinutes = (existing.endTime.getTime() - existing.startTime.getTime()) / 60_000;
  const gapMinutes = Math.max(0, windowMinutes - existing.duration);
  return overlapMs / 60_000 - gapMinutes >= MIN_ENTRY_MINUTES;
}

/**
 * The same person's time, logged twice.
 *
 * Nothing compared a window with the ones already logged, so 09:00–17:00 could
 * be entered three times and the day counted as 24 hours worked — in the
 * member's total, the billing figures and the approval queue alike. Their own
 * entries in this workspace only: another workspace is another employer's
 * timesheet, and a REJECTED entry is time that was thrown out.
 */
export async function assertNoOverlap(
  prisma: Pick<Prisma.TransactionClient, 'timeEntry'>,
  scope: { userId: string; workspaceId: string; startTime: Date; endTime: Date; excludeId?: string },
): Promise<void> {
  const candidates = await prisma.timeEntry.findMany({
    where: {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      status: { not: 'REJECTED' },
      startTime: { lt: scope.endTime },
      endTime: { gt: scope.startTime },
      ...(scope.excludeId ? { id: { not: scope.excludeId } } : {}),
    },
    select: {
      startTime: true,
      endTime: true,
      duration: true,
      taskHierarchyId: true,
      taskTitle: true,
      projectName: true,
      description: true,
    },
    orderBy: { startTime: 'asc' },
  });
  const clash = candidates.find((entry) => overlapsWorkedTime(entry, scope.startTime, scope.endTime));
  if (!clash) return;
  const work =
    [clash.taskHierarchyId, clash.taskTitle].filter(Boolean).join(' ') ||
    clash.projectName ||
    clash.description ||
    'another entry';
  throw new ConflictException({
    message:
      `This overlaps time you have already logged here (${work}, ${minutesInWords(clash.duration)}). ` +
      'Change the times, or correct that entry instead.',
    type: 'TimeEntryOverlap',
  });
}

/**
 * May this person log time in this workspace — exactly the check filing does,
 * RBAC switch included, answered rather than thrown.
 */
export async function mayLogTime(
  access: WorkspaceAccessService,
  user: User,
  workspaceId: string,
): Promise<boolean> {
  try {
    await access.assertPermission(user, workspaceId, Permission.HrWrite);
    return true;
  } catch (err) {
    if (err instanceof ForbiddenException) return false;
    throw err;
  }
}

const APPROVED_IS_KEPT =
  'An approved entry cannot be deleted — it has been signed off. Edit it instead: a change sends it back for approval.';

/**
 * What a time entry calls its task and project, read from the records. They
 * used to be whatever the browser sent — the form sent no project name, so the
 * timesheet fell back to "—", and a timer's entry never carried one either.
 */
export async function namesOfWork(
  prisma: Pick<PrismaService, 'task' | 'project'>,
  taskId?: string | null,
  projectId?: string | null,
): Promise<{ taskTitle: string; taskHierarchyId: string; projectName: string }> {
  const [task, project] = await Promise.all([
    taskId
      ? prisma.task.findUnique({ where: { id: taskId }, select: { title: true, hierarchyId: true } })
      : null,
    projectId ? prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }) : null,
  ]);
  return {
    taskTitle: task?.title ?? '',
    taskHierarchyId: task?.hierarchyId ?? '',
    projectName: project?.name ?? '',
  };
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
      startTime: { field: 'startTime', type: 'date' },
      endTime: { field: 'endTime', type: 'date' },
    },
    sortable: { createdAt: 'createdAt', startTime: 'startTime' },
    defaultOrderBy: { startTime: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: TimeEntry) {
    return timeEntryResponse(row);
  }

  /** Whether the caller may see the whole workspace's entries, or only their own. */
  private async canApprove(user: User, workspaceId?: string | string[]): Promise<boolean> {
    if (this.access.isPlatformAdmin(user)) return true;
    if (typeof workspaceId !== 'string' || !workspaceId) return false;
    return this.access.can(user, workspaceId, Permission.TimeApprove);
  }

  /**
   * A time entry is personal data, and a BILLABLE one carries a rate.
   *
   * There was no override here, so the base class scoped reads to the caller's
   * workspaces and nothing further: every member — including the read-only
   * MEMBER role — could list every colleague's entries, descriptions and
   * billable rates. Measured: MEMBER read a developer's entry complete with its
   * 250/hour rate. Same rule as attendance now: your own rows, unless you hold
   * the permission that exists to review other people's.
   */
  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof timeEntryResponse>>> {
    if (await this.canApprove(user, query.workspaceId)) {
      // The wide read is for the workspace that was just checked, and no other —
      // same reasoning as the attendance and leave lists.
      const wide =
        typeof query.workspaceId === 'string' && !this.access.isPlatformAdmin(user)
          ? pinScopeParam(query, 'workspaceId', query.workspaceId)
          : query;
      return super.list(user, wide);
    }
    // Drop every caller-supplied userId predicate before forcing the caller's
    // own id. Overwriting the `userId` KEY alone is not enough: the suffixed
    // forms (`userId__ne`, `userId__in`, `userId__not_in`) are separate keys that
    // parseListQuery merges onto the same `where.userId` last-one-wins, so
    // `?userId=me&userId__ne=__none__` would replace the forced equality with a
    // negation. Same shape as attendance and leave.
    const scoped: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key === 'userId' || key.startsWith('userId__')) continue;
      scoped[key] = value;
    }
    return super.list(user, { ...scoped, userId: user.id });
  }

  /**
   * How much time has been logged against a task — by everybody.
   *
   * An entry is personal (it can carry a rate), so the list above gives a
   * member only their own. The task's time card was built on that list, and so
   * showed each person their own minutes under the heading "Total Logged": a
   * developer looking at a task three colleagues had spent a week on read
   * "0m", and the over-estimate warning fired on one person's share.
   *
   * How long a task has taken is a fact about the task, and anybody who can
   * open the task can have it. This returns the totals and nothing personal:
   * no entries, no names, no rates — only how many people the time is from,
   * and the caller's own part of it.
   *
   * Rejected entries are left out: time an approver refused is not time the
   * task is taken to have cost.
   */
  async taskSummary(user: User, taskId: string) {
    if (!taskId) throw new BadRequestException('taskId is required.');
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { workspaceId: true },
    });
    if (!task) throw new NotFoundException('Not found.');
    await this.access.assertMember(user, task.workspaceId);
    const entries = await this.prisma.timeEntry.findMany({
      where: { taskId, workspaceId: task.workspaceId, status: { not: 'REJECTED' } },
      select: { userId: true, duration: true, isBillable: true, status: true },
    });
    const sum = (rows: typeof entries): number => rows.reduce((total, row) => total + row.duration, 0);
    const mine = entries.filter((entry) => entry.userId === user.id);
    return {
      taskId,
      totalMinutes: sum(entries),
      billableMinutes: sum(entries.filter((entry) => entry.isBillable)),
      approvedMinutes: sum(entries.filter((entry) => entry.status === 'APPROVED')),
      entryCount: entries.length,
      /** How many people the time is from. */
      people: new Set(entries.map((entry) => entry.userId)).size,
      mine: { totalMinutes: sum(mine), entryCount: mine.length },
    };
  }

  /** Who approves time in this workspace — the people an entry waits on. */
  async approvers(user: User, workspaceId: string) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertPermission(user, workspaceId, Permission.HrRead);
    const ids = await this.access.membersHolding(workspaceId, Permission.TimeApprove);
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    return people.map((person) => ({ userId: person.id, name: person.name || person.email }));
  }

  /** By-id reads need the same rule the list does. */
  async retrieve(user: User, id: string) {
    const row = await this.findScoped(user, id);
    await this.assertRowOwnership(user, row);
    return this.map(row);
  }
  /**
   * Run `write` holding a lock on this person's timesheet in this workspace.
   *
   * The overlap check is check-then-act: two saves arriving together (a double
   * click, a second tab) would both look, both find nothing, and both land. The
   * same transaction-scoped advisory lock leave requests take, so the pair
   * queues up and the second one sees the first.
   *
   * `write` is handed the transaction and must do ALL its reading and writing
   * through it. It used the shared client instead, so every save held one
   * pooled connection for the lock and then waited for a second for its work.
   * Twenty saves at once (a script, a bulk import, a double-clicking browser on
   * a slow line) filled the pool with transactions queued on the lock; the one
   * holding it could not get its second connection; the queue timed out
   * ("Transaction already closed") and 98 of 110 entries were refused — while
   * every other request in the API waited on the same exhausted pool.
   */
  private async serialized<T>(
    userId: string,
    workspaceId: string,
    write: (db: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const lockKey = `time:${workspaceId}:${userId}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      return write(tx);
    });
  }

  async create(user: User, dto: CreateTimeEntryDto) {
    const startTime = toRequiredDate(dto.startTime, 'Start time');
    const endTime = toRequiredDate(dto.endTime, 'End time');
    const duration = loggedMinutes(startTime, endTime);
    // Authorize before the overlap probe reads anything in the target workspace.
    await this.access.assertPermission(user, dto.workspaceId, this.createPermission);
    // The task names its project; a form that sends only the task is answered
    // with the task's project rather than refused for leaving it out.
    const task = dto.taskId
      ? await this.prisma.task.findUnique({ where: { id: dto.taskId }, select: { projectId: true } })
      : null;
    if (dto.taskId && !task) throw new NotFoundException('That task no longer exists.');
    const projectId = dto.projectId || task?.projectId || '';
    await assertProjectInWorkspace(this.prisma, projectId, dto.workspaceId);
    await assertLinkInProject(this.prisma, 'task', 'Task', dto.taskId, projectId);
    // No new time against an archived project or its tasks (see project-archive).
    // Entries already logged stay correctable, and decidable: they are people's
    // records of hours worked, not part of the project.
    await assertProjectWritable(this.prisma, projectId);
    const named = await namesOfWork(this.prisma, dto.taskId, projectId);
    const row = await this.serialized(user.id, dto.workspaceId, async (db) => {
      await assertNoOverlap(db, {
        userId: user.id,
        workspaceId: dto.workspaceId,
        startTime,
        endTime,
      });
      // userId/userName/userEmail/createdById are stamped from the caller.
      // `createManyAndReturn`, not `create`: the realtime write hook fires on a
      // `create` the moment it returns — here that is inside the transaction,
      // before the commit — and the frame is sent below, once there is
      // something committed for its readers to fetch.
      const [inserted] = await db.timeEntry.createManyAndReturn({
        data: [
          {
            id: generateId(),
            workspaceId: dto.workspaceId,
            userId: user.id,
            userName: user.name || user.email,
            userEmail: user.email,
            createdById: user.id,
            createdByName: user.name ?? '',
            taskId: dto.taskId ?? '',
            projectId,
            ...named,
            description: dto.description ?? '',
            startTime,
            endTime,
            duration,
            isBillable: dto.isBillable ?? false,
            status: 'PENDING',
            tags: (dto.tags ?? []) as Prisma.InputJsonValue,
          },
        ],
      });
      return inserted;
    });
    // What `createIn` does after its insert (its permission check ran above).
    this.prisma.announceWrite?.('TimeEntry', 'create', row);
    await this.recordAudit(user, dto.workspaceId, 'created', row.id, row);
    await announceTimeAwaiting(this.access, this.events, user, dto.workspaceId);
    return this.map(row);
  }
  async patch(user: User, id: string, dto: UpdateTimeEntryDto) {
    const data: Record<string, unknown> = {};
    if (dto.startTime !== undefined) data.startTime = toRequiredDate(dto.startTime, 'Start time');
    if (dto.endTime !== undefined) data.endTime = toRequiredDate(dto.endTime, 'End time');
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isBillable !== undefined) data.isBillable = dto.isBillable;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (Object.keys(data).length === 0) return this.retrieve(user, id);
    /**
     * An entry that has been decided cannot be quietly rewritten UNDER the
     * decision. The owner could edit an approved entry's hours and description
     * while status/approvedBy/approvedAt stayed put, so the manager's approval
     * went on vouching for figures they never saw. Editing re-opens it: the
     * decision is cleared and the entry goes back in the queue, which keeps the
     * entry correctable without ever letting an approval outlive its numbers.
     */
    const row = await this.findScoped(user, id);
    this.assertOwnerOnly(user, row, 'change');
    await this.access.assertPermission(user, row.workspaceId, this.updatePermission);
    const startTime = (data.startTime as Date | undefined) ?? row.startTime;
    const endTime = (data.endTime as Date | undefined) ?? row.endTime;
    // A window sent back exactly as it is stored is not an edit of it. The edit
    // dialog used to send both ends on every save and the duration was
    // recomputed from them whatever had changed — so fixing a typo in the
    // description gave a paused timer's entry its pause back, and cut an entry
    // longer than the dialog can show (a weekend left running, from before the
    // 24-hour rule) down to whatever its two clock times made.
    const windowMoved =
      startTime.getTime() !== row.startTime.getTime() || endTime.getTime() !== row.endTime.getTime();
    delete data.startTime;
    delete data.endTime;
    if (windowMoved) {
      data.startTime = startTime;
      data.endTime = endTime;
      // From the pair the row will END UP with, so moving one end of the window
      // can never leave the stored duration describing the old one.
      data.duration = loggedMinutes(startTime, endTime);
    }
    if (Object.keys(data).length === 0) return this.map(row);
    if (row.status === 'APPROVED' || row.status === 'REJECTED') {
      data.status = 'PENDING';
      data.approvedBy = '';
      data.approvedAt = null;
      data.rejectionReason = '';
    }
    // On the lock's own transaction when the window moves (see `serialized`).
    const write = async (db: Pick<Prisma.TransactionClient, 'timeEntry'>) => {
      if (windowMoved) {
        await assertNoOverlap(db, {
          userId: row.userId,
          workspaceId: row.workspaceId,
          startTime,
          endTime,
          excludeId: id,
        });
      }
      // Conditional on the status the edit was decided against. A plain update
      // by id let an edit read while PENDING land after an approval: the entry
      // stayed APPROVED, now vouching for hours the approver never saw. The
      // approval claims on the figures it saw for the same reason.
      const { count } = await db.timeEntry.updateMany({
        where: { id, status: row.status },
        data: data as Prisma.TimeEntryUpdateManyMutationInput,
      });
      if (count === 0) {
        throw new ConflictException({
          message:
            'This entry was approved, rejected or deleted while you were editing it, so your ' +
            'change was not saved. Reload to see where it stands.',
          type: CHANGED_WHILE_EDITING_TYPE,
        });
      }
    };
    if (windowMoved) await this.serialized(row.userId, row.workspaceId, write);
    else await write(this.prisma);
    const updated = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id } });
    // A conditional `updateMany` — see PrismaService.announceWrite.
    this.prisma.announceWrite?.('TimeEntry', 'update', updated);
    return this.map(updated);
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    this.assertOwnerOnly(user, row, 'delete');
    // An approved entry is a record somebody signed off. The timesheet hid its
    // Delete button and the API did not ask, so the hours a manager had approved
    // could be made to vanish from the record by anyone with the URL. Editing
    // it stays possible — that sends it back for approval.
    if (row.status === 'APPROVED') {
      throw new BadRequestException(APPROVED_IS_KEPT);
    }
    await this.access.assertPermission(user, row.workspaceId, this.writePermission);
    // Conditional, because the approval it races is: one landing between the
    // check above and this delete must not be deleted out from under.
    const { count } = await this.prisma.timeEntry.deleteMany({
      where: { id, status: { not: 'APPROVED' } },
    });
    if (count === 0) {
      const still = await this.prisma.timeEntry.findUnique({ where: { id }, select: { id: true } });
      if (still) throw new BadRequestException(APPROVED_IS_KEPT);
      throw new NotFoundException('Not found.');
    }
    // `deleteMany` is invisible to the realtime write hook.
    this.prisma.announceWrite?.('TimeEntry', 'delete', row);
  }

  /**
   * Hours are logged by the person who worked them. An approver approves or
   * rejects an entry — and the owner is told either way; editing or deleting
   * somebody's entry told them nothing, so hours could be changed under them
   * and then approved.
   */
  private assertOwnerOnly(user: User, row: TimeEntry, verb: string): void {
    if (row.userId === user.id || this.access.isPlatformAdmin(user)) return;
    throw new ForbiddenException(
      `Only the person who logged this time can ${verb} it. An approver approves or rejects it.`,
    );
  }
}

type TimerWithState = ReturnType<typeof activeTimerResponse> & {
  /** Whether stopping it can file an entry (see ActiveTimersService.withState). */
  canLog: boolean;
  /** It was started on a task that has since been deleted. */
  taskMissing: boolean;
};

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<TimerWithState>> {
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
    const rows = await Promise.all(items.map((t) => this.withState(user, t)));
    return paginate(rows, total, parsed.page, parsed.pageSize);
  }

  async retrieve(user: User, id: string) {
    const t = await this.prisma.activeTimer.findUnique({ where: { id } });
    if (!t || t.userId !== user.id) throw new NotFoundException('Not found.');
    return this.withState(user, t);
  }

  /**
   * The timer, and whether it can still become an entry.
   *
   * A timer outlives what it was started for. Its owner can be removed from the
   * workspace or lose the right to log time there, and its task can be deleted
   * — and the header chip kept ticking and linking to a dead task, while Stop
   * answered 403 and the only Stop button lived on a task page that no longer
   * opened. Said here so the browser can offer what still works: `canLog` false
   * means filing is refused (discard it), `taskMissing` that no task card exists
   * to stop it from.
   */
  private async withState(user: User, t: ActiveTimer): Promise<TimerWithState> {
    const [canLog, task] = await Promise.all([
      // A timer from before timers recorded a workspace is filed in whichever
      // one the caller names when they stop it, so it is not blocked here.
      t.workspaceId ? mayLogTime(this.access, user, t.workspaceId) : true,
      t.taskId
        ? this.prisma.task.findUnique({ where: { id: t.taskId }, select: { id: true } })
        : null,
    ]);
    return { ...activeTimerResponse(t), canLog, taskMissing: Boolean(t.taskId) && !task };
  }

  /**
   * Throw the caller's own timer away, writing nothing.
   *
   * Deliberately asks for no workspace permission: this is the way out for a
   * timer whose workspace the owner can no longer write to — the case where
   * stopping it is refused — and a person's own clock is always theirs to stop.
   */
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
}

/**
 * Time is waiting for approval: tell the people who approve it — once, until
 * they have looked. Entries were filed as PENDING with no word to anybody, so an
 * approval queue filled up unseen.
 */
export async function announceTimeAwaiting(
  access: WorkspaceAccessService,
  events: EventEmitter2 | undefined,
  user: User,
  workspaceId: string,
): Promise<void> {
  // Nobody to tell without an emitter (a unit test builds the service bare).
  if (!events) return;
  const approvers = (await access.membersHolding(workspaceId, Permission.TimeApprove)).filter(
    (id) => id !== user.id,
  );
  tellPeople(events, {
    workspaceId,
    recipients: approvers,
    actorId: user.id,
    type: 'TIME_ENTRY_SUBMITTED',
    title: 'Time waiting for your approval',
    message: `${user.name || user.email} logged time that needs approving. Open Approvals to decide.`,
    relatedEntityType: 'TIME_ENTRY',
    oncePerUnread: true,
  });
}
