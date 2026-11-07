import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { generateId, optionalScopeParam, pinScopeParam, type ListQuerySpec } from '@strata/common';
import { HrEvents } from '@strata/shared';
import { businessDayMarker, workScheduleOf } from '@strata/config';
import { PrismaService } from '@strata/prisma';
import type { LeaveBalance, LeaveRequest, Prisma, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { emitDomainEvent } from '../workspaces/domain-event';
import { CHANGED_WHILE_EDITING_TYPE, ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  AdjustLeaveBalanceDto,
  CreateLeaveRequestDto,
  UpdateLeaveRequestDto,
} from './dto';
import {
  BALANCE_YEAR_MESSAGE,
  LEAVE_TYPE_TO_BALANCE_FIELD,
  MAX_LEAVE_RANGE_DAYS,
  OPEN_LEAVE_STATUSES,
  countWorkingDays,
  dateOnlyKey,
  ensureLeaveBalance,
  isAllowedBalanceYear,
  parseDateOnly,
  requiredUnits,
} from './leave-balance';
import { leaveBalanceResponse, leaveRequestResponse } from './mappers';
import { tellPeople } from '../notifications/notice';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reads of leave data are personal: a caller only ever sees their own rows
 * unless they name a workspace (`?workspaceId=`) where they hold
 * `leave:approve`. Without this, `hr:read` — which every member holds — would
 * expose colleagues' medical/family leave reasons and remaining balances.
 */
async function scopeQueryToCaller(
  access: WorkspaceAccessService,
  user: User,
  query: Record<string, string | string[] | undefined>,
): Promise<Record<string, string | string[] | undefined>> {
  if (access.isPlatformAdmin(user)) return query;
  // optionalScopeParam, NOT the required variant: an absent workspaceId
  // legitimately means "scope this to my own requests", so throwing would break
  // the ordinary path. But a REPEATED one has to resolve — under the old
  // `typeof === 'string'` test ?workspaceId=A&workspaceId=A read as absent, the
  // leave:approve check silently failed, and an approver saw only their own leave.
  const workspaceId = optionalScopeParam(query.workspaceId, 'workspaceId');
  // The wide read is for THAT workspace only. Returning the query as it came let
  // `?workspaceId=<where I approve>&workspaceId__in=<where I am a plain member>`
  // carry the approver's reach into a workspace where they hold no such right.
  if (workspaceId && (await access.can(user, workspaceId, Permission.LeaveApprove))) {
    return pinScopeParam(query, 'workspaceId', workspaceId);
  }
  // Every caller-supplied userId predicate is dropped before the caller's own id
  // is forced. Overwriting the `userId` key alone was NOT enough: the suffixed
  // forms are separate keys, and parseListQuery merges them onto the same
  // `where.userId` last-one-wins — so `?userId=x&userId__ne=nobody` replaced the
  // forced equality with a negation and returned the whole workspace's leave,
  // reasons and all. Dropping them keeps the query able to narrow, never widen.
  const scoped: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key === 'userId' || key.startsWith('userId__')) continue;
    scoped[key] = value;
  }
  return { ...scoped, userId: user.id };
}

/** The balance figures an approver sets by hand (`unpaidLeave` is a counter). */
type AdjustableField = 'paidLeave' | 'halfDay' | 'compOff';

const FIELD_LABEL: Record<AdjustableField, string> = {
  paidLeave: 'Paid leave',
  halfDay: 'Half-day sessions',
  compOff: 'Comp-off',
};

/**
 * What the approver believed the figures being written held, from `basedOn` —
 * only for the fields actually being written, so the check is never wider than
 * the edit. Anything that is not a number is refused rather than ignored: a
 * baseline that silently dropped out would look exactly like a protected save.
 */
function believedFigures(
  basedOn: Record<string, unknown> | undefined,
  data: Partial<Record<AdjustableField, number>>,
): Partial<Record<AdjustableField, number>> {
  if (!basedOn) return {};
  const believed: Partial<Record<AdjustableField, number>> = {};
  for (const field of Object.keys(data) as AdjustableField[]) {
    if (!(field in basedOn)) continue;
    const value = basedOn[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`basedOn.${field} must be a number.`);
    }
    believed[field] = value;
  }
  return believed;
}

/** Leave that is not planned, and so may be recorded after it has begun. */
const AFTER_THE_FACT_LEAVE: ReadonlySet<string> = new Set(['SICK', 'BEREAVEMENT', 'UNPAID']);
/** ...and for how long afterwards. */
const AFTER_THE_FACT_DAYS = 30;

@Injectable()
export class LeaveRequestsService extends ScopedCrudService<
  LeaveRequest,
  ReturnType<typeof leaveRequestResponse>
> {
  protected readonly model = 'leaveRequest';
  protected readonly auditEntity = 'leave_request';
  protected readonly writePermission: PermissionKey = Permission.HrWrite; // members submit their own
  /** A leave request belongs to the member who took the leave; only an
   *  approver may touch somebody else's. */
  protected readonly ownerField = 'userId';
  protected readonly ownerOverridePermission: PermissionKey = Permission.LeaveApprove;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      type: { field: 'type' },
      startDate: { field: 'startDate', type: 'date' },
      endDate: { field: 'endDate', type: 'date' },
    },
    sortable: { createdAt: 'createdAt', startDate: 'startDate' },
    defaultOrderBy: { createdAt: 'desc' },
  };
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: LeaveRequest) {
    return leaveRequestResponse(row);
  }

  async list(user: User, query: Record<string, string | string[] | undefined>) {
    return super.list(user, await scopeQueryToCaller(this.access, user, query));
  }

  async retrieve(user: User, id: string) {
    const row = await this.findScoped(user, id);
    await this.assertRowOwnership(user, row); // reads are personal too
    return this.map(row);
  }

  /**
   * Who is away, for everybody.
   *
   * A leave request is personal: its type and its reason are between the
   * person and whoever approves it, which is why the list above gives a member
   * only their own. The team calendar was built on that same list — so for
   * everyone who does not approve leave it counted their own absences and
   * announced "0 people away" on a day half the team was out.
   *
   * THAT somebody is away, and until when, is not private; it is what a team
   * calendar is for. So this gives every member the approved absences and
   * nothing else about them: no type, no reason, no balance.
   */
  async away(user: User, workspaceId: string, from?: string, to?: string) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertPermission(user, workspaceId, Permission.HrRead);
    const now = Date.now();
    const start = from ? parseDateOnly(from) : new Date(now - 62 * MS_PER_DAY);
    const end = to ? parseDateOnly(to) : new Date(now + MAX_LEAVE_RANGE_DAYS * MS_PER_DAY);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('from and to must be YYYY-MM-DD dates.');
    }
    // Bounded by its dates, not by a row cap: `take: 1000` dropped whoever came
    // after the thousandth absence without saying so.
    if (end < start || (end.getTime() - start.getTime()) / MS_PER_DAY > 2 * MAX_LEAVE_RANGE_DAYS) {
      throw new BadRequestException('from must come before to, at most two years apart.');
    }
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        workspaceId,
        status: 'APPROVED',
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { id: true, userId: true, startDate: true, endDate: true, type: true },
      orderBy: { startDate: 'asc' },
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { id: true, name: true, email: true },
    });
    const nameOf = new Map(people.map((person) => [person.id, person.name || person.email]));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: nameOf.get(row.userId) ?? '',
      startDate: dateOnlyKey(row.startDate),
      endDate: dateOnlyKey(row.endDate),
      halfDay: row.type === 'HALF_DAY',
    }));
  }

  /**
   * Who decides leave in this workspace — so a request can say who it is
   * waiting for, and somebody who is the only approver can be told that their
   * own requests are theirs to decide.
   */
  async approvers(user: User, workspaceId: string) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertPermission(user, workspaceId, Permission.HrRead);
    const ids = await this.access.membersHolding(workspaceId, Permission.LeaveApprove);
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    return people.map((person) => ({ userId: person.id, name: person.name || person.email }));
  }

  async create(user: User, dto: CreateLeaveRequestDto) {
    // Authorize before the overlap/balance probes touch the target workspace.
    await this.access.assertPermission(user, dto.workspaceId, this.writePermission);
    const range = await this.resolveRange(dto.workspaceId, dto.type, dto.startDate, dto.endDate);

    /**
     * Serialize submissions for this member in this workspace.
     *
     * The overlap and affordability checks below are check-then-act: two
     * requests arriving together both looked, both saw nothing committed, and
     * both inserted — so the same person could double-book the same dates and
     * spend the same balance twice. (Reproduced: two identical POSTs fired in
     * parallel both returned 201.)
     *
     * A transaction-scoped advisory lock makes the pair queue up. The key is
     * per member+workspace, so unrelated submissions never wait on each other,
     * and the lock releases when this transaction ends. The insert is made
     * INSIDE the transaction, so it is committed and visible before the second
     * caller acquires the lock and runs its own checks.
     *
     * Every read and write in here goes through `tx`, the connection holding
     * the lock. They used the shared client, which made each submission hold
     * one pooled connection while it waited for a second: enough submissions
     * at once and the pool was all lock-waiters, the holder starved, and every
     * request in the API stalled with it (the same fault, found in time
     * entries, refused 98 of 110 saves).
     */
    const lockKey = `leave:${dto.workspaceId}:${user.id}`;
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      await this.assertNoOverlap(user.id, dto.workspaceId, range.startDate, range.endDate, undefined, tx);
      await this.assertAffordable(
        user.id,
        dto.workspaceId,
        dto.type,
        range.startDate,
        range.daysCount,
        undefined,
        tx,
      );
      // user + createdById are stamped from the caller. `createManyAndReturn`
      // because the realtime write hook fires on a `create` before the commit;
      // the frame is sent below instead.
      const [inserted] = await tx.leaveRequest.createManyAndReturn({
        data: [
          {
            id: generateId(),
            workspaceId: dto.workspaceId,
            userId: user.id,
            createdById: user.id,
            createdByName: user.name ?? '',
            type: dto.type,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: dto.reason,
            status: 'PENDING',
            daysCount: range.daysCount,
          },
        ],
      });
      return inserted;
    });
    // What `createIn` does after its insert (the permission was checked above).
    this.prisma.announceWrite?.('LeaveRequest', 'create', row);
    await this.recordAudit(user, dto.workspaceId, 'created', row.id, row);
    const created = this.map(row);
    // Tell whoever can approve it — after the commit, and from here rather than
    // from the requester's browser (see WorkNotificationSubscriber).
    emitDomainEvent(this.events, HrEvents.LeaveRequested, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: user.id,
      leaveRequestId: created.id,
      type: dto.type,
      daysCount: range.daysCount,
      requesterName: user.name || user.email,
    });
    return created;
  }

  async patch(user: User, id: string, dto: UpdateLeaveRequestDto) {
    const row = await this.findScoped(user, id);
    this.assertRequesterOnly(user, row, 'change');
    // A decided request is a record of a decision: editing it would desync the
    // deducted units from the dates. Cancel and resubmit instead.
    if (row.status !== 'PENDING') {
      throw new BadRequestException('Only a pending leave request can be edited.');
    }
    // Only an edit that MOVES the request is re-validated. Re-deriving the range
    // unconditionally meant fixing a typo in `reason` re-ran assertAffordable
    // against a balance another request had since debited — a 400 "Insufficient
    // leave balance" for an edit that changed no dates — and silently rewrote
    // `daysCount` on legacy rows, changing what approval would deduct.
    const touchesRange =
      dto.type !== undefined || dto.startDate !== undefined || dto.endDate !== undefined;
    const data: Record<string, unknown> = {};
    if (touchesRange) {
      const type = dto.type ?? row.type;
      const range = await this.resolveRange(
        row.workspaceId,
        type,
        dto.startDate ?? row.startDate.toISOString(),
        dto.endDate ?? row.endDate.toISOString(),
      );
      await this.assertNoOverlap(row.userId, row.workspaceId, range.startDate, range.endDate, id);
      await this.assertAffordable(
        row.userId,
        row.workspaceId,
        type,
        range.startDate,
        range.daysCount,
        id,
      );
      data.type = type;
      data.startDate = range.startDate;
      data.endDate = range.endDate;
      data.daysCount = range.daysCount;
    }
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (Object.keys(data).length === 0) return this.map(row);
    await this.access.assertPermission(user, row.workspaceId, this.updatePermission);
    // Conditional on it still being PENDING. The status was read above, on an
    // earlier statement, and a plain update by id let an edit land after an
    // approval: a request approved for 1 day became an APPROVED request for 5,
    // with 1 debited — and cancelling it later refunded 5. The approval claims
    // on the dates and days it decided against for the same reason.
    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: data as Prisma.LeaveRequestUpdateManyMutationInput,
    });
    if (count === 0) {
      throw new ConflictException({
        message:
          'This request was approved, rejected or withdrawn while you were editing it, so your change was not saved. Reload to see where it stands.',
        type: CHANGED_WHILE_EDITING_TYPE,
      });
    }
    const updated = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    // A conditional `updateMany` — see PrismaService.announceWrite.
    this.prisma.announceWrite?.('LeaveRequest', 'update', updated);
    await this.recordAudit(user, row.workspaceId, 'updated', id, updated, Object.keys(data));
    return this.map(updated);
  }

  /**
   * A leave request is its requester's to change or withdraw. An approver
   * approves or rejects it — both of which tell the requester. Editing or
   * deleting it was allowed too (the override that lets them READ it), and
   * neither said a word: a request could be rewritten and then approved.
   */
  private assertRequesterOnly(user: User, row: LeaveRequest, verb: string): void {
    if (row.userId === user.id || this.access.isPlatformAdmin(user)) return;
    throw new ForbiddenException(
      `Only the person who asked for this leave can ${verb} it. An approver approves or rejects it.`,
    );
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    this.assertRequesterOnly(user, row, 'delete');
    if (row.status === 'APPROVED') {
      // Deleting an approved leave would strand the units already deducted.
      throw new BadRequestException('Cancel an approved leave request before deleting it.');
    }
    await super.remove(user, id);
  }

  /** The workspace's public holidays inside a range, as 'YYYY-MM-DD' keys.
   *  Optional holidays are excluded — the office is open, so taking one is
   *  ordinary leave. */
  private async holidaysIn(
    workspaceId: string,
    start: Date,
    end: Date,
  ): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.holiday.findMany({
      where: { workspaceId, isOptional: false, date: { gte: start, lte: end } },
      select: { date: true },
    });
    return new Set(rows.map((r) => dateOnlyKey(r.date)));
  }

  /** Validate the requested range and derive the day count from it — the
   *  client never authors `daysCount`, so it can never be zero or negative.
   *  Public holidays are excluded from the count: they are not working days, and
   *  charging a member's balance for one is a silent loss of entitlement. */
  private async resolveRange(
    workspaceId: string,
    type: string,
    startDate: string,
    endDate: string,
  ) {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate and endDate must be YYYY-MM-DD dates.');
    }
    if (end < start) {
      throw new BadRequestException('End date cannot be before the start date.');
    }
    if ((end.getTime() - start.getTime()) / MS_PER_DAY > MAX_LEAVE_RANGE_DAYS) {
      throw new BadRequestException('A leave request cannot span more than a year.');
    }
    if (type === 'HALF_DAY' && end.getTime() !== start.getTime()) {
      throw new BadRequestException('A half-day leave must start and end on the same day.');
    }
    // When leave may START. The form refused every past date and the API
    // accepted any, so the rule was whichever door was used: nobody could
    // record through the screen that they had been ill yesterday — which is
    // when sickness is reported — while a script could book last year. Leave
    // is asked for ahead; the kinds that are not planned can be recorded for a
    // while afterwards.
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const today = businessDayMarker(workScheduleOf(workspace?.settings).timeZone);
    const afterTheFact = AFTER_THE_FACT_LEAVE.has(type);
    const earliest = new Date(
      today.getTime() - (afterTheFact ? AFTER_THE_FACT_DAYS : 0) * MS_PER_DAY,
    );
    if (start.getTime() < earliest.getTime()) {
      throw new BadRequestException(
        afterTheFact
          ? `Leave can be recorded up to ${AFTER_THE_FACT_DAYS} days after the fact. For anything earlier, ask whoever approves leave here to adjust your balance.`
          : 'This kind of leave has to be requested before it starts. Sick, bereavement and unpaid leave can be recorded afterwards.',
      );
    }
    const workingDays = countWorkingDays(start, end, await this.holidaysIn(workspaceId, start, end));
    if (workingDays === 0) {
      throw new BadRequestException('The selected dates contain no working days.');
    }
    return { startDate: start, endDate: end, daysCount: type === 'HALF_DAY' ? 0.5 : workingDays };
  }

  /** One absence per day: a pending or approved request already covering any
   *  of the dates blocks a second one. */
  private async assertNoOverlap(
    userId: string,
    workspaceId: string,
    startDate: Date,
    endDate: Date,
    excludeId?: string,
    /** The lock-holding transaction, when called under the submission lock. */
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const clash = await db.leaveRequest.findFirst({
      where: {
        workspaceId,
        userId,
        status: { in: OPEN_LEAVE_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('You already have a leave request covering these dates.');
    }
  }

  /** Reject a request the member cannot afford, counting the units already
   *  committed to their other PENDING requests for the same balance field —
   *  approval debits the row, so un-decided requests are invisible to it. */
  private async assertAffordable(
    userId: string,
    workspaceId: string,
    type: string,
    startDate: Date,
    daysCount: number,
    excludeId?: string,
    /** The lock-holding transaction, when called under the submission lock. */
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const year = startDate.getUTCFullYear();
    // Bound BEFORE `ensureLeaveBalance` upserts: validating a 2035 request used
    // to provision a 2035 row seeded with the full default allocation, which
    // `approve` then happily debited.
    if (!isAllowedBalanceYear(year)) {
      throw new BadRequestException(`Leave dates are out of range — ${BALANCE_YEAR_MESSAGE}`);
    }
    if (type === 'UNPAID') return; // unpaid leave has no allowance
    const field = LEAVE_TYPE_TO_BALANCE_FIELD[type];
    const balance = await ensureLeaveBalance(db, workspaceId, userId, year);
    const open = await db.leaveRequest.findMany({
      where: {
        workspaceId,
        userId,
        status: 'PENDING',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { type: true, daysCount: true, startDate: true },
    });
    const committed = open
      .filter(
        (r) =>
          r.startDate.getUTCFullYear() === year && LEAVE_TYPE_TO_BALANCE_FIELD[r.type] === field,
      )
      .reduce((sum, r) => sum + requiredUnits(r.type, r.daysCount), 0);
    const available = balance[field] - committed;
    const units = requiredUnits(type, daysCount);
    if (units > available) {
      throw new BadRequestException(
        `Insufficient leave balance: ${units} day(s) requested, ${Math.max(0, available)} available.`,
      );
    }
  }
}

@Injectable()
export class LeaveBalancesService extends ScopedCrudService<
  LeaveBalance,
  ReturnType<typeof leaveBalanceResponse>
> {
  protected readonly model = 'leaveBalance';
  protected readonly auditEntity = 'leave_balance';
  protected readonly writePermission: PermissionKey = Permission.LeaveApprove; // balances are manager-managed
  /** A balance row is as personal as the requests it funds. `list` is already
   *  narrowed to the caller by `scopeQueryToCaller`, but the by-id read was not:
   *  every member holds `hr:read`, so any colleague's remaining allowance was
   *  one GET away. */
  protected readonly ownerField = 'userId';
  protected readonly ownerOverridePermission: PermissionKey = Permission.LeaveApprove;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      year: { field: 'year', type: 'number' },
    },
    sortable: { createdAt: 'createdAt', year: 'year' },
    defaultOrderBy: { year: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService,
    private readonly balanceEvents?: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: LeaveBalance) {
    return leaveBalanceResponse(row);
  }

  async list(user: User, query: Record<string, string | string[] | undefined>) {
    return super.list(user, await scopeQueryToCaller(this.access, user, query));
  }

  async retrieve(user: User, id: string) {
    const row = await this.findScoped(user, id);
    await this.assertRowOwnership(user, row); // reads are personal too
    return this.map(row);
  }

  /** GET leave_balances/me — the caller's own row for a year, provisioned with
   *  the default allocation on first use. Members cannot POST a balance (that
   *  is `leave:approve`), so without this nobody could ever have one. */
  async mine(user: User, workspaceId: string, year?: number) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required.');
    }
    await this.access.assertMember(user, workspaceId);
    // Bounded so a stray `?year=` cannot seed rows for arbitrary years. Same
    // window the leave-request paths enforce (isAllowedBalanceYear).
    const target = year ?? new Date().getUTCFullYear();
    if (!isAllowedBalanceYear(target)) {
      throw new BadRequestException(BALANCE_YEAR_MESSAGE);
    }
    return this.map(await ensureLeaveBalance(this.prisma, workspaceId, user.id, target));
  }

  private assertBalanceYear(year: number): void {
    if (!isAllowedBalanceYear(year)) throw new BadRequestException(BALANCE_YEAR_MESSAGE);
  }

  /**
   * GET leave_balances/team — one row per ACTIVE member, for whoever allocates
   * leave.
   *
   * Balances are provisioned lazily, the first time a member opens their own
   * Leave page. So the plain list showed an approver only the members who had
   * happened to look, and there was no screen to look from in the first place:
   * nobody could grant comp-off, correct an allowance, or see who had how much
   * left. Every member is provisioned here on the way out, so the answer is
   * complete — the same default allocation `mine` would have given them.
   */
  async team(user: User, workspaceId: string, year?: number) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertPermission(user, workspaceId, Permission.LeaveApprove);
    const target = year ?? new Date().getUTCFullYear();
    this.assertBalanceYear(target);

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      select: { userId: true, role: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows = [];
    for (const member of members) {
      const person = byId.get(member.userId);
      if (!person) continue; // a membership whose account is gone
      const balance = await ensureLeaveBalance(this.prisma, workspaceId, member.userId, target);
      rows.push({
        ...this.map(balance),
        userName: person.name || person.email,
        userEmail: person.email,
        role: member.role,
      });
    }
    return rows.sort((a, b) => a.userName.localeCompare(b.userName));
  }

  /**
   * POST leave_balances/adjust — set a member's allowance for a year.
   *
   * The generic POST/PATCH pair could do this, but took the subject's `userId`
   * on trust (any string, in any workspace) and let an approver rewrite their
   * OWN row — the same self-dealing the approval flow refuses. Here the subject
   * must be an active member of this workspace and somebody other than the
   * caller, and the row is provisioned first if they have never had one.
   *
   * `unpaidLeave` is deliberately not adjustable: it counts unpaid days TAKEN,
   * which approvals maintain.
   */
  async adjust(user: User, dto: AdjustLeaveBalanceDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.LeaveApprove);
    this.assertBalanceYear(dto.year);
    if (dto.userId === user.id && !this.access.isPlatformAdmin(user)) {
      // The leave rule: your own allowance is another approver's to change —
      // unless there is no other approver, when it was nobody's at all.
      const others = (
        await this.access.membersHolding(dto.workspaceId, Permission.LeaveApprove)
      ).filter((holder) => holder !== user.id);
      if (others.length > 0) {
        throw new ForbiddenException(
          'You cannot change your own leave balance. Ask another approver.',
        );
      }
    }
    if (!(await this.access.activeMembership(dto.userId, dto.workspaceId))) {
      throw new BadRequestException('That person is not an active member of this workspace.');
    }
    const balance = await ensureLeaveBalance(this.prisma, dto.workspaceId, dto.userId, dto.year);
    const data: Partial<Record<AdjustableField, number>> = {};
    if (dto.paidLeave !== undefined) data.paidLeave = dto.paidLeave;
    if (dto.halfDay !== undefined) data.halfDay = dto.halfDay;
    if (dto.compOff !== undefined) data.compOff = dto.compOff;
    if (Object.keys(data).length === 0) return this.map(balance);
    /**
     * Written conditionally on the figures the approver was looking at.
     *
     * The figures are absolute, and approvals and cancellations move the same
     * row from other people's browsers. An approver who opened the dialog on 21
     * days and typed 25 wrote 25 over an approval that had just taken it to 16
     * — handing the five approved days straight back. With `basedOn` (what the
     * dialog was filled with) a figure that has moved since is refused, and the
     * approver sees the new one before deciding again. Checked per field, on the
     * fields being written only. A caller that sends no baseline (an older
     * client) writes as before.
     */
    const believed = believedFigures(dto.basedOn, data);
    const { count } = await this.prisma.leaveBalance.updateMany({
      where: { id: balance.id, ...believed },
      data,
    });
    if (count === 0) {
      const now = await this.prisma.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } });
      const moved = (Object.keys(believed) as AdjustableField[]).filter(
        (field) => now[field] !== believed[field],
      );
      const what = moved.length
        ? moved
            .map((field) => `${FIELD_LABEL[field]} changed from ${believed[field]} to ${now[field]}`)
            .join(', ')
        : 'The balance changed';
      throw new ConflictException({
        message:
          `${what} while you were editing — leave was approved or cancelled meanwhile. ` +
          'Nothing was saved: check the current figures and adjust again.',
        type: CHANGED_WHILE_EDITING_TYPE,
        fields: moved,
      });
    }
    const updated = await this.prisma.leaveBalance.findUniqueOrThrow({ where: { id: balance.id } });
    // A conditional `updateMany` is invisible to the realtime write hook, and is
    // audited here as `update` would have audited it.
    this.prisma.announceWrite?.('LeaveBalance', 'update', updated);
    await this.recordAudit(user, dto.workspaceId, 'updated', balance.id, updated, Object.keys(data));
    const result = this.map(updated);
    // ...and the person whose allowance it is, is told. An approver could move
    // somebody's days up or down and the first they knew was the number.
    tellPeople(this.balanceEvents, {
      workspaceId: dto.workspaceId,
      recipients: [dto.userId],
      actorId: user.id,
      type: 'LEAVE_BALANCE_ADJUSTED',
      title: `Leave balance changed for ${dto.year}`,
      message: `${user.name || user.email} changed your leave balance for ${dto.year}. Open Leave to see what you have now.`,
      relatedEntityId: balance.id,
      relatedEntityType: 'LEAVE',
    });
    return result;
  }

}
