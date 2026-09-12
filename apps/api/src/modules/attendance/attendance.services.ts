import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { generateId, toDate, toRequiredDate, type ListQuerySpec } from '@strata/common';
import type { PaginatedResponse } from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import type { Attendance, Holiday, User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import { DENY_MESSAGE, WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from '../workspaces/scoped-crud.base';
import {
  calculateLateMinutes,
  calculateWorkHours,
  determineAttendanceStatus,
  isLateCheckIn,
  isWeekend,
} from './attendance-compute';
import type {
  CheckInDto,
  CheckOutDto,
  CreateAttendanceDto,
  CreateHolidayDto,
  UpdateAttendanceDto,
  UpdateHolidayDto,
} from './dto';
import { attendanceResponse, holidayResponse } from './mappers';

/**
 * The server's LOCAL calendar day, stored as UTC midnight. The `date` column is
 * a day marker, not an instant: keying it off the local day (like
 * attendance-compute's time-of-day rules, which read local hours) keeps a 01:00
 * check-in on the day the employee is actually working, and the mapper renders
 * it back unshifted. Day-level rules (isWeekend) then read this marker's UTC
 * parts, so they describe exactly the day the row is filed under.
 */
const todayUtc = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/** Manager-level HR marker. Attendance rows are personal, so a caller may only
 *  file/read/alter someone else's with the workspace's HR-approver permission. */
const HR_MANAGE: PermissionKey = Permission.LeaveApprove;

/** The only columns the subject of an attendance row may set themselves: soft
 *  annotations that claim nothing about when they arrived or how long they
 *  stayed. Everything else (the times, the status, the late/work figures, the
 *  day flags) is server-computed evidence and takes `HR_MANAGE`. */
const SELF_EDITABLE = new Set(['location', 'notes']);

@Injectable()
export class AttendanceService extends ScopedCrudService<
  Attendance,
  ReturnType<typeof attendanceResponse>
> {
  protected readonly model = 'attendance';
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  protected readonly ownerField = 'userId';
  protected readonly ownerOverridePermission: PermissionKey = HR_MANAGE;
  protected readonly spec: ListQuerySpec = {
    filterable: {
      workspaceId: { field: 'workspaceId' },
      userId: { field: 'userId' },
      status: { field: 'status' },
      date: { field: 'date', type: 'date' },
    },
    sortable: { createdAt: 'createdAt', date: 'date' },
    defaultOrderBy: { date: 'desc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Attendance) {
    return attendanceResponse(row);
  }

  /** Attendance is personal data: a plain member only ever lists their own rows,
   *  an HR manager lists the whole workspace. */
  async list(
    user: User,
    query: Record<string, string | string[] | undefined>,
  ): Promise<PaginatedResponse<ReturnType<typeof attendanceResponse>>> {
    if (await this.canManage(user, query.workspaceId)) return super.list(user, query);
    // Drop every caller-supplied userId predicate before forcing the caller's
    // own id. Overwriting the `userId` KEY alone was not enough: the suffixed
    // forms (`userId__ne`, `userId__in`, `userId__not_in`) are separate keys and
    // parseListQuery merges them onto the same `where.userId` last-one-wins, so
    // `?userId=me&userId__ne=__none__` replaced the forced equality with a
    // negation and returned every colleague's check-in/out times, late minutes
    // and ON_LEAVE markers. Same shape as leave's `scopeQueryToCaller`.
    const scoped: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(query)) {
      if (key === 'userId' || key.startsWith('userId__')) continue;
      scoped[key] = value;
    }
    return super.list(user, { ...scoped, userId: user.id });
  }

  async retrieve(user: User, id: string) {
    const row = await this.findScoped(user, id);
    await this.assertRowOwnership(user, row);
    return this.map(row);
  }

  /**
   * File an attendance row by hand.
   *
   * This is an HR correction, not a way to attend: check-in/check-out is the
   * only path a member has, and everything it records is computed on the server
   * for exactly that reason. Left open, this endpoint undid all of it — any
   * member (hr:write is in the MEMBER baseline) could POST a Sunday with 9
   * hours, a date 15 months out, 24 work hours inside a 30-minute window, or a
   * check-out before the check-in, and the calendar, the manager's Team tab and
   * the analytics rate all rendered it as fact.
   *
   * So: managers only, and the figures that describe the day are DERIVED here
   * rather than taken from the request.
   */
  async create(user: User, dto: CreateAttendanceDto) {
    await this.access.assertPermission(user, dto.workspaceId, HR_MANAGE);
    const date = toRequiredDate(dto.date, 'Date');
    const checkInTime = toRequiredDate(dto.checkInTime, 'Check-in time');
    const checkOutTime = toDate(dto.checkOutTime, 'Check-out time');
    if (date.getTime() > todayUtc().getTime()) {
      throw new BadRequestException('Attendance cannot be filed for a future date.');
    }
    if (checkOutTime && checkOutTime.getTime() <= checkInTime.getTime()) {
      throw new BadRequestException('Check-out must be after the check-in.');
    }
    const workHours = checkOutTime ? calculateWorkHours(checkInTime, checkOutTime) : null;
    // The day marker's own properties, read off the workspace calendar and the
    // calendar itself rather than taken from the request.
    const isHoliday = (await this.closedHolidayOn(dto.workspaceId, date)) !== null;
    const dayIsWeekend = isWeekend(date);
    const officeOpen = !isHoliday && !dayIsWeekend;
    const arrival = this.arrivalFigures(checkInTime, officeOpen);
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: await this.subjectOf(user, dto.workspaceId, dto.userId),
      createdById: user.id,
      createdByName: user.name ?? '',
      date,
      checkInTime,
      checkOutTime,
      // Derived from the times, exactly as check-in/check-out derive them, so a
      // manual row cannot claim hours its own timestamps do not support.
      workHours,
      status:
        dto.status === 'ABSENT' || dto.status === 'ON_LEAVE' || dto.status === 'HALF_DAY'
          ? dto.status
          : checkOutTime
            ? determineAttendanceStatus(checkInTime, checkOutTime, workHours ?? 0, officeOpen)
            : arrival.status,
      lateMinutes: arrival.lateMinutes,
      location: dto.location ?? '',
      notes: dto.notes ?? '',
      isWeekend: dayIsWeekend,
      // A closed day is filed, not blocked — and this flag is how the calendar,
      // the Team tab and the analytics denominator all know to read it as work
      // done on a shut day rather than an ordinary attended one.
      isHoliday,
    });
  }

  /**
   * The workspace calendar's entry for a day on which the office is SHUT, or
   * null.
   *
   * `isOptional` holidays are deliberately excluded: a restricted holiday is
   * one the office stays open for, so it is an ordinary working day that a
   * member may spend by taking leave. That is already how the rest of the
   * product reads the calendar — `LeaveRequestsService.holidaysIn` filters
   * `isOptional: false` before deriving a leave day count, and the browser's
   * `useHolidays` filters it before building the analytics denominator. This
   * used to match on the date alone, so an optional holiday stamped
   * `isHoliday: true` on a row that every other surface counted as a normal
   * working day.
   */
  private async closedHolidayOn(
    workspaceId: string,
    date: Date,
  ): Promise<{ name: string } | null> {
    return this.prisma.holiday.findFirst({
      where: { workspaceId, isOptional: false, date },
      select: { name: true },
    });
  }
  /**
   * The lateness half of an arrival, given whether the office was OPEN that day.
   *
   * A shut day — a declared holiday, a Sunday, a non-working Saturday — has no
   * expected start time, so nothing done on it can be late. Grading a holiday
   * arrival against the 08:30 schedule is what filed somebody who came in at
   * 09:11 as LATE by 41 minutes on a day nobody was expected at all. The day is
   * still recorded (`isHoliday`/`isWeekend` are what tell every other surface
   * how to read it); it is simply not marked against a clock the office was not
   * keeping.
   */
  private arrivalFigures(at: Date, officeOpen: boolean): { lateMinutes: number; status: string } {
    return {
      lateMinutes: officeOpen ? calculateLateMinutes(at) : 0,
      status: officeOpen && isLateCheckIn(at) ? 'LATE' : 'PRESENT',
    };
  }

  async patch(user: User, id: string, dto: UpdateAttendanceDto) {
    const data: Record<string, unknown> = {};
    if (dto.checkOutTime !== undefined) data.checkOutTime = dto.checkOutTime ? new Date(dto.checkOutTime) : null;
    if (dto.workHours !== undefined) data.workHours = dto.workHours;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.lateMinutes !== undefined) data.lateMinutes = dto.lateMinutes;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isWeekend !== undefined) data.isWeekend = dto.isWeekend;
    if (dto.isHoliday !== undefined) data.isHoliday = dto.isHoliday;
    await this.assertMayEdit(user, id, Object.keys(data));
    return this.update(user, id, data);
  }

  /**
   * Attendance is an HR record, and `ownerField` alone does not protect it: the
   * subject of the row IS its owner, so the base guard waved them through to
   * rewrite the very figures check-in computed on the server. The subject may
   * annotate their day; only an HR manager may restate what it was.
   */
  private async assertMayEdit(user: User, id: string, fields: string[]): Promise<void> {
    const forensic = fields.filter((f) => !SELF_EDITABLE.has(f));
    if (forensic.length === 0) return;
    const row = await this.findScoped(user, id);
    if (await this.canManage(user, this.workspaceOf(row))) return;
    throw new ForbiddenException(
      `Only an HR manager can change ${forensic.join(', ')} on an attendance record.`,
    );
  }

  /**
   * Deleting the day is the same forgery as editing it — erase a late arrival,
   * check in again, arrive on time. The subject cannot; an HR manager can.
   */
  async remove(user: User, id: string): Promise<void> {
    const row = await this.findScoped(user, id);
    if (!(await this.canManage(user, this.workspaceOf(row)))) {
      throw new ForbiddenException('Only an HR manager can delete an attendance record.');
    }
    return super.remove(user, id);
  }

  /** Whose attendance the row is for: only an HR manager may file someone else's. */
  private async subjectOf(user: User, workspaceId: string, userId?: string): Promise<string> {
    if (!userId || userId === user.id) return user.id;
    if (await this.access.can(user, workspaceId, HR_MANAGE)) return userId;
    throw new ForbiddenException(DENY_MESSAGE);
  }

  private async canManage(user: User, workspaceId?: string | string[]): Promise<boolean> {
    if (this.access.isPlatformAdmin(user)) return true;
    if (typeof workspaceId !== 'string' || !workspaceId) return false;
    return this.access.can(user, workspaceId, HR_MANAGE);
  }

  /** Server-computed check-in (lateMinutes + status). */
  async checkIn(user: User, dto: CheckInDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const date = todayUtc();
    // The workspace calendar LABELS this day; it does not veto it.
    //
    // Check-in used to refuse outright on a declared (non-optional) holiday,
    // which fixed the wrong half of the problem. People do work holidays, and
    // check-in is the only self-service way to record one — so refusing left
    // whoever came in with nothing but an HR round trip, for a row the server
    // can file correctly by itself. What was actually wrong was the FIGURES: the
    // arrival was graded LATE against an 08:30 start nobody was expected to
    // make, on a day the analytics denominator does not count.
    //
    // So the row is written and stamped `isHoliday` — the flag the calendar, the
    // Team tab and the attendance rate (numerator AND denominator) already read
    // to keep a shut day out of the working-day counts — and `arrivalFigures`
    // withholds the lateness. A restricted (`isOptional`) holiday is not this:
    // the office is open, so `closedHolidayOn` ignores those and the day is
    // graded like any other.
    const isHoliday = (await this.closedHolidayOn(dto.workspaceId, date)) !== null;
    const dayIsWeekend = isWeekend(date);
    const now = new Date();
    const arrival = this.arrivalFigures(now, !isHoliday && !dayIsWeekend);
    const existing = await this.prisma.attendance.findFirst({
      where: { workspaceId: dto.workspaceId, userId: user.id, date },
    });
    // Approving leave materialises an ON_LEAVE marker for every covered working
    // day (leave-approval's materializeLeaveAttendance). Someone who comes in
    // anyway is checking in for the FIRST time, not twice — and they cannot
    // escape it by cancelling, since leave that has already started is not
    // cancellable. Convert the marker in place instead of refusing; the row
    // stops being ON_LEAVE, so a later cancellation (which deletes only
    // ON_LEAVE rows) leaves the real attendance alone.
    if (existing && existing.status === 'ON_LEAVE' && !existing.checkOutTime) {
      const converted = await this.prisma.attendance.update({
        where: { id: existing.id },
        data: {
          checkInTime: now,
          ...arrival,
          isWeekend: dayIsWeekend,
          // Leave approval materialises its markers without consulting the
          // calendar, so an ON_LEAVE row can be sitting on a holiday with the
          // flag still false. Turning it into a real attendance row has to
          // correct that, or the day lands in the counts a holiday stays out of.
          isHoliday,
          ...(dto.location ? { location: dto.location } : {}),
          // Keep the "Approved <type> leave" note as the audit trail for why
          // the row already existed.
          ...(dto.notes ? { notes: `${existing.notes || ''}\n${dto.notes}`.trim() } : {}),
        },
      });
      return attendanceResponse(converted);
    }
    // One row per (workspace, user, day). Distinguish "still checked in" from
    // "day already finished" — telling someone who has checked out to "check out
    // first" is nonsense, and letting it fall through would hit the @@unique and
    // surface the opaque generic "A record with these values already exists.".
    if (existing) {
      throw new BadRequestException(
        existing.checkOutTime
          ? 'You have already completed attendance for today'
          : 'Already checked in today',
      );
    }
    const record = await this.prisma.attendance.create({
      data: {
        id: generateId(),
        workspaceId: dto.workspaceId,
        userId: user.id,
        date,
        checkInTime: now,
        ...arrival,
        // Both read off the row's own day marker, not `now`: a flag has to
        // describe the day the row is filed under.
        isHoliday,
        isWeekend: dayIsWeekend,
        location: dto.location ?? '',
        notes: dto.notes ?? '',
        createdById: user.id,
        createdByName: user.name ?? '',
      },
    });
    return attendanceResponse(record);
  }

  /** Server-computed check-out (workHours + status). */
  async checkOut(user: User, dto: CheckOutDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const date = todayUtc();
    const record = await this.prisma.attendance.findFirst({
      where: { workspaceId: dto.workspaceId, userId: user.id, date },
    });
    if (!record) throw new BadRequestException('Not checked in today');
    // A leave-materialised ON_LEAVE row IS today's row and has a non-null
    // check-in pinned to the day marker (UTC midnight) with no check-out, so
    // both guards below used to pass: checking out at 17:00 without ever
    // checking in credited a full day of fabricated `workHours`, rewrote the row
    // to PRESENT/LATE and destroyed the ON_LEAVE marker that the team view reads
    // and that `cancel` deletes by. `checkIn` converts such a row in place;
    // check-out has nothing to close.
    if (record.status === 'ON_LEAVE' && record.checkInTime.getTime() === record.date.getTime()) {
      throw new BadRequestException('Not checked in today');
    }
    if (record.checkOutTime) throw new BadRequestException('Already checked out today');
    const now = new Date();
    if (now < record.checkInTime) throw new BadRequestException('Check-out precedes check-in');
    const workHours = calculateWorkHours(record.checkInTime, now);
    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        workHours,
        // Same rule as the arrival: a day the office was shut had no expected
        // start, so closing it out grades the hours and can never come back
        // LATE. Without the flags here, check-out reinstated the very lateness
        // `arrivalFigures` had just declined to record.
        status: determineAttendanceStatus(
          record.checkInTime,
          now,
          workHours,
          !record.isHoliday && !record.isWeekend,
        ),
        ...(dto.notes ? { notes: `${record.notes || ''}\n${dto.notes}`.trim() } : {}),
      },
    });
    return attendanceResponse(updated);
  }
}

@Injectable()
export class HolidaysService extends ScopedCrudService<Holiday, ReturnType<typeof holidayResponse>> {
  protected readonly model = 'holiday';
  protected readonly auditEntity = 'holiday';
  // Workspace-level calendar configuration, NOT a personal record: HrWrite is in
  // the member baseline, so writes take the HR-manager permission instead.
  protected readonly writePermission: PermissionKey = HR_MANAGE;
  protected readonly spec: ListQuerySpec = {
    filterable: { workspaceId: { field: 'workspaceId' }, date: { field: 'date', type: 'date' } },
    sortable: { createdAt: 'createdAt', date: 'date' },
    defaultOrderBy: { date: 'asc' },
  };
  constructor(prisma: PrismaService, access: WorkspaceAccessService) {
    super(prisma, access);
  }
  protected map(row: Holiday) {
    return holidayResponse(row);
  }
  create(user: User, dto: CreateHolidayDto) {
    return this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      name: dto.name,
      date: new Date(dto.date),
      isOptional: dto.isOptional ?? false,
      description: dto.description ?? '',
    });
  }
  patch(user: User, id: string, dto: UpdateHolidayDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.isOptional !== undefined) data.isOptional = dto.isOptional;
    if (dto.description !== undefined) data.description = dto.description;
    return this.update(user, id, data);
  }
}
