import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { type ListQuerySpec } from '@strata/common';
import { PrismaService } from '@strata/prisma';
import type { LeaveBalance, LeaveRequest, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import type {
  CreateLeaveBalanceDto,
  CreateLeaveRequestDto,
  UpdateLeaveBalanceDto,
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
  const workspaceId = typeof query.workspaceId === 'string' ? query.workspaceId : undefined;
  if (workspaceId && (await access.can(user, workspaceId, Permission.LeaveApprove))) return query;
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
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
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
     * and the lock releases when this transaction ends. The insert is awaited
     * INSIDE the transaction, so it is committed and visible before the second
     * caller acquires the lock and runs its own checks.
     */
    const lockKey = `leave:${dto.workspaceId}:${user.id}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
      await this.assertNoOverlap(user.id, dto.workspaceId, range.startDate, range.endDate);
      await this.assertAffordable(
        user.id,
        dto.workspaceId,
        dto.type,
        range.startDate,
        range.daysCount,
      );
      // user + createdById are stamped from the caller.
      return this.createIn(user, dto.workspaceId, {
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
      });
    });
  }

  async patch(user: User, id: string, dto: UpdateLeaveRequestDto) {
    const row = await this.findScoped(user, id);
    await this.assertRowOwnership(user, row);
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
    return this.update(user, id, data);
  }

  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
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
  ): Promise<void> {
    const clash = await this.prisma.leaveRequest.findFirst({
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
    const balance = await ensureLeaveBalance(this.prisma, workspaceId, userId, year);
    const open = await this.prisma.leaveRequest.findMany({
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
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
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

  create(user: User, dto: CreateLeaveBalanceDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: dto.userId,
      year: dto.year,
      paidLeave: dto.paidLeave ?? 0,
      unpaidLeave: dto.unpaidLeave ?? 0,
      halfDay: dto.halfDay ?? 0,
      compOff: dto.compOff ?? 0,
    });
  }
  patch(user: User, id: string, dto: UpdateLeaveBalanceDto) {
    const data: Record<string, unknown> = {};
    if (dto.paidLeave !== undefined) data.paidLeave = dto.paidLeave;
    if (dto.unpaidLeave !== undefined) data.unpaidLeave = dto.unpaidLeave;
    if (dto.halfDay !== undefined) data.halfDay = dto.halfDay;
    if (dto.compOff !== undefined) data.compOff = dto.compOff;
    return this.update(user, id, data);
  }
}
