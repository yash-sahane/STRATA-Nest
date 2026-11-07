import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { generateId, pinScopeParam, toDate, toRequiredDate, type ListQuerySpec } from '@strata/common';
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
import { businessDayMarker, workScheduleOf, type WorkSchedule } from '@strata/config';
import {
  type CalendarReconciliation,
  mergeReconciliations,
  reconcileCalendarDay,
} from '../leave/holiday-reconcile';
import { lockCalendar } from '../leave/calendar-lock';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { tellPeople } from '../notifications/notice';


/** Manager-level HR marker. Attendance rows are personal, so a caller may only
 *  file/read/alter someone else's with the workspace's HR-approver permission. */
const HR_MANAGE: PermissionKey = Permission.LeaveApprove;

/**
 * A calendar change and its re-count run as one transaction, and the re-count
 * can touch every request and attendance row across the day — more than the
 * five seconds Prisma gives an interactive transaction by default.
 */
const CALENDAR_TRANSACTION = { maxWait: 10_000, timeout: 60_000 };

/** What a calendar change re-counted, as the API reports it (without the rows it announced). */
const summary = ({ unannounced: _rows, ...counts }: CalendarReconciliation) => counts;

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * How long after a check-in the shift it opened is still taken to be running.
 *
 * A day is filed under the date it STARTED on, and check-out used to look only
 * for a row filed under today — so anybody still at work when the office's day
 * rolled over could never check out: "Not checked in today", from a system that
 * had their check-in. Within this window the open row from the previous day is
 * the shift in progress. Past it, the check-out was simply forgotten, and what
 * the hours were is for whoever corrects attendance to say.
 */
const MAX_SHIFT_HOURS = 16;

/** How far back an unclosed day is still brought to its owner's attention. */
const UNCLOSED_LOOKBACK_DAYS = 31;

/**
 * An arrival on a day the person holds approved half-day leave for.
 *
 * Nothing in attendance knew the leave existed. Somebody with the morning off
 * who came in at 13:00 was LATE by four and a half hours, and one who left at
 * lunchtime could close the day PRESENT. A day with half of it on leave is a
 * half day, and there is no start time for it to be late against.
 */
const HALF_DAY_ARRIVAL: { lateMinutes: number; status: string } = {
  lateMinutes: 0,
  status: 'HALF_DAY',
};

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
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    private readonly events?: EventEmitter2,
  ) {
    super(prisma, access);
  }

  /**
   * Somebody else filed, corrected or deleted this person's day.
   *
   * Attendance is the record a person's hours and lateness are read from, and
   * a manager could restate any of it without the person being told: the first
   * they knew was a figure that no longer matched what they remembered. Their
   * own check-in and check-out tell them nothing new and are not announced.
   */
  private announceRestated(
    actor: User,
    row: { id?: string; workspaceId: string; userId: string; date: Date },
    what: 'filed' | 'corrected' | 'deleted',
  ): void {
    if (row.userId === actor.id) return;
    const day = row.date.toISOString().slice(0, 10);
    tellPeople(this.events, {
      workspaceId: row.workspaceId,
      recipients: [row.userId],
      actorId: actor.id,
      type: 'ATTENDANCE_CORRECTED',
      title: `Attendance ${what} for ${day}`,
      message: `${actor.name || actor.email} ${what} your attendance for ${day}. Check the day on your attendance calendar.`,
      relatedEntityId: row.id ?? '',
      relatedEntityType: 'ATTENDANCE',
    });
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
    if (await this.canManage(user, query.workspaceId)) {
      // The wide read is for the workspace that was just checked, and no other:
      // `?workspaceId=<where I manage>&workspaceId__in=<where I am a plain member>`
      // otherwise carried HR-manager reach into the second workspace.
      const wide =
        typeof query.workspaceId === 'string' && !this.access.isPlatformAdmin(user)
          ? pinScopeParam(query, 'workspaceId', query.workspaceId)
          : query;
      return super.list(user, wide);
    }
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
  /**
   * Today's day marker, in the WORKSPACE's declared timezone.
   *
   * The `date` column is a day MARKER, not an instant: it is the local day stored as UTC
   * midnight, so a 01:00 check-in stays on the day the employee is actually working and
   * the mapper renders it back unshifted. Day-level rules (isWeekend) then read this
   * marker's UTC parts, so they describe exactly the day the row is filed under.
   *
   * Which local day, though, used to mean the SERVER's — a deployment detail. An
   * organisation's working day belongs to its office, so `settings.timezone` is the
   * declaration. Absent or unrecognised, this falls back to the server's zone, which is
   * the behaviour before the setting existed: a bad value must not be able to stop people
   * checking in.
   */
  private async businessToday(workspaceId: string): Promise<Date> {
    return (await this.officeClock(workspaceId)).today;
  }

  /**
   * The office's day and the office's hours, from one read of its settings.
   *
   * The hours are the other half of the same declaration. "Late" was measured
   * against 08:30 plus fifteen minutes for every workspace, on the SERVER's wall
   * clock — so an office that starts at 10:00 had everybody late every day, and
   * one in Kolkata on a UTC host had nobody late ever (09:00 IST is 03:30 there).
   * A workspace now states its own start and grace period, and both are read in
   * the timezone it files its days in.
   */
  private async officeClock(workspaceId: string): Promise<{ today: Date; schedule: WorkSchedule }> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const schedule = workScheduleOf(ws?.settings);
    return { today: businessDayMarker(schedule.timeZone), schedule };
  }

  async create(user: User, dto: CreateAttendanceDto) {
    await this.access.assertPermission(user, dto.workspaceId, HR_MANAGE);
    const date = toRequiredDate(dto.date, 'Date');
    const checkInTime = toRequiredDate(dto.checkInTime, 'Check-in time');
    const checkOutTime = toDate(dto.checkOutTime, 'Check-out time');
    const { today, schedule } = await this.officeClock(dto.workspaceId);
    if (date.getTime() > today.getTime()) {
      throw new BadRequestException('Attendance cannot be filed for a future date.');
    }
    if (checkOutTime && checkOutTime.getTime() <= checkInTime.getTime()) {
      throw new BadRequestException('Check-out must be after the check-in.');
    }
    const workHours = checkOutTime ? calculateWorkHours(checkInTime, checkOutTime) : null;
    // The day marker's own properties, read off the workspace calendar and the
    // calendar itself rather than taken from the request.
    const isHoliday = (await this.closedHolidayOn(dto.workspaceId, date)) !== null;
    const dayIsWeekend = isWeekend(date, schedule);
    const officeOpen = !isHoliday && !dayIsWeekend;
    const subject = await this.subjectOf(user, dto.workspaceId, dto.userId);
    await this.assertNotOwnRecord(user, dto.workspaceId, subject, 'file');
    const halfDay = await this.onHalfDayLeave(dto.workspaceId, subject, date);
    const arrival = halfDay
      ? HALF_DAY_ARRIVAL
      : this.arrivalFigures(checkInTime, officeOpen, schedule);
    const filed = await this.createIn(user, dto.workspaceId, {
      workspaceId: dto.workspaceId,
      userId: subject,
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
          : checkOutTime && !halfDay
            ? determineAttendanceStatus(
                checkInTime,
                checkOutTime,
                workHours ?? 0,
                officeOpen,
                schedule,
              )
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
    this.announceRestated(user, { workspaceId: dto.workspaceId, userId: subject, date }, 'filed');
    return filed;
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
  private arrivalFigures(
    at: Date,
    officeOpen: boolean,
    schedule: WorkSchedule,
  ): { lateMinutes: number; status: string } {
    return {
      lateMinutes: officeOpen ? calculateLateMinutes(at, schedule) : 0,
      status: officeOpen && isLateCheckIn(at, schedule) ? 'LATE' : 'PRESENT',
    };
  }

  async patch(user: User, id: string, dto: UpdateAttendanceDto) {
    const data: Record<string, unknown> = {};
    if (dto.checkInTime !== undefined) {
      data.checkInTime = toRequiredDate(dto.checkInTime, 'Check-in time');
    }
    if (dto.checkOutTime !== undefined) data.checkOutTime = dto.checkOutTime ? new Date(dto.checkOutTime) : null;
    if (dto.workHours !== undefined) data.workHours = dto.workHours;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.lateMinutes !== undefined) data.lateMinutes = dto.lateMinutes;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isWeekend !== undefined) data.isWeekend = dto.isWeekend;
    if (dto.isHoliday !== undefined) data.isHoliday = dto.isHoliday;
    await this.assertMayEdit(user, id, Object.keys(data));
    /**
     * A corrected TIME restates the day, so the figures that describe it are
     * derived again here — exactly as `create` and check-in/out derive them.
     *
     * Corrections were possible through this route but only half-made: a manager
     * could move the check-out and the row kept the hours, the lateness and the
     * status of the times it used to have, unless they also did that arithmetic
     * themselves and sent it along. An explicit status in the same request still
     * wins, which is how a day is restated as ABSENT, ON_LEAVE or a HALF_DAY.
     */
    if (data.checkInTime !== undefined || data.checkOutTime !== undefined) {
      const row = await this.findScoped(user, id);
      const checkIn = (data.checkInTime as Date | undefined) ?? row.checkInTime;
      const checkOut =
        data.checkOutTime !== undefined ? (data.checkOutTime as Date | null) : row.checkOutTime;
      if (checkOut && checkOut.getTime() <= checkIn.getTime()) {
        throw new BadRequestException('Check-out must be after the check-in.');
      }
      const workHours = checkOut ? calculateWorkHours(checkIn, checkOut) : null;
      const officeOpen = !row.isHoliday && !row.isWeekend;
      const { schedule } = await this.officeClock(row.workspaceId);
      const halfDay = await this.onHalfDayLeave(row.workspaceId, row.userId, row.date);
      const arrival = halfDay
        ? HALF_DAY_ARRIVAL
        : this.arrivalFigures(checkIn, officeOpen, schedule);
      data.workHours = workHours;
      data.lateMinutes = arrival.lateMinutes;
      if (dto.status === undefined) {
        data.status =
          checkOut && !halfDay
            ? determineAttendanceStatus(checkIn, checkOut, workHours ?? 0, officeOpen, schedule)
            : arrival.status;
      }
    }
    const result = await this.update(user, id, data);
    // Only a restatement of the day itself: a note added to it is not one.
    const restated = Object.keys(data).some((field) => !SELF_EDITABLE.has(field));
    if (restated) {
      this.announceRestated(
        user,
        {
          id,
          workspaceId: result.workspaceId,
          userId: result.userId,
          date: new Date(`${result.date}T00:00:00.000Z`),
        },
        'corrected',
      );
    }
    return result;
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
    if (await this.canManage(user, this.workspaceOf(row))) {
      await this.assertNotOwnRecord(user, row.workspaceId, row.userId, 'correct');
      return;
    }
    throw new ForbiddenException(
      `Only an HR manager can change ${forensic.join(', ')} on an attendance record.`,
    );
  }

  /**
   * An HR manager's own day is somebody else's to restate.
   *
   * Leave and time already held to this — your own balance, your own leave
   * (unless you are the only approver) and your own hours are decided by another
   * approver. Attendance did not: a manager could delete their own late arrival
   * and file an on-time day in its place, and since the change was their own
   * nobody was told. The same exception as leave: when nobody else holds the
   * permission, there is nobody else to ask.
   */
  private async assertNotOwnRecord(
    user: User,
    workspaceId: string,
    subjectId: string,
    verb: 'file' | 'correct' | 'delete',
  ): Promise<void> {
    if (subjectId !== user.id || this.access.isPlatformAdmin(user)) return;
    const others = (await this.access.membersHolding(workspaceId, HR_MANAGE)).filter(
      (id) => id !== user.id,
    );
    if (others.length === 0) return;
    throw new ForbiddenException(
      `Another HR manager has to ${verb} your own attendance — you cannot ${verb} a day of your own record.`,
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
    await this.assertNotOwnRecord(user, row.workspaceId, row.userId, 'delete');
    await super.remove(user, id);
    this.announceRestated(user, row, 'deleted');
  }

  /** Whose attendance the row is for: only an HR manager may file someone else's. */
  private async subjectOf(user: User, workspaceId: string, userId?: string): Promise<string> {
    if (!userId || userId === user.id) return user.id;
    if (!(await this.access.can(user, workspaceId, HR_MANAGE))) {
      throw new ForbiddenException(DENY_MESSAGE);
    }
    // Any account id was accepted, and the "attendance filed" notice then went
    // to that account — a person who may not belong to this workspace at all.
    if (!(await this.access.activeMembership(userId, workspaceId))) {
      throw new BadRequestException('That person is not an active member of this workspace.');
    }
    return userId;
  }

  private async canManage(user: User, workspaceId?: string | string[]): Promise<boolean> {
    if (this.access.isPlatformAdmin(user)) return true;
    if (typeof workspaceId !== 'string' || !workspaceId) return false;
    return this.access.can(user, workspaceId, HR_MANAGE);
  }

  /** Server-computed check-in (lateMinutes + status). */
  /** Whether this person holds APPROVED half-day leave for this day. */
  private async onHalfDayLeave(workspaceId: string, userId: string, date: Date): Promise<boolean> {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { workspaceId, userId, status: 'APPROVED', type: 'HALF_DAY', startDate: date },
      select: { id: true },
    });
    return leave !== null;
  }

  /**
   * The shift this person started on the previous business day and has not
   * closed, while it can still be the one in progress — see MAX_SHIFT_HOURS.
   */
  private async continuingShift(
    workspaceId: string,
    userId: string,
    today: Date,
  ): Promise<Attendance | null> {
    const row = await this.prisma.attendance.findFirst({
      where: {
        workspaceId,
        userId,
        date: new Date(today.getTime() - MS_PER_DAY),
        checkOutTime: null,
        status: { not: 'ON_LEAVE' },
      },
    });
    if (!row) return null;
    return Date.now() - row.checkInTime.getTime() <= MAX_SHIFT_HOURS * MS_PER_HOUR ? row : null;
  }

  /**
   * Where the caller stands right now: the row check-out would close, and the
   * most recent earlier day that was never closed.
   *
   * The browser used to work this out by asking for "the row dated today",
   * which is the wrong question twice over. After midnight it found nothing and
   * offered Check In to somebody in the middle of a shift; and a day whose
   * check-out was forgotten vanished from view the next morning, still open,
   * with nobody told — not the person, who could no longer close it, and not
   * whoever could correct it.
   */
  async current(user: User, workspaceId: string) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required.');
    await this.access.assertPermission(user, workspaceId, Permission.HrRead);
    const { today } = await this.officeClock(workspaceId);
    const mine = { workspaceId, userId: user.id };
    const todays = await this.prisma.attendance.findFirst({ where: { ...mine, date: today } });
    const running = todays ? null : await this.continuingShift(workspaceId, user.id, today);
    const unclosed = await this.prisma.attendance.findFirst({
      where: {
        ...mine,
        date: {
          lt: today,
          gte: new Date(today.getTime() - UNCLOSED_LOOKBACK_DAYS * MS_PER_DAY),
        },
        checkOutTime: null,
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
        ...(running ? { id: { not: running.id } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    const record = todays ?? running;
    return {
      record: record ? attendanceResponse(record) : null,
      /** True when `record` is yesterday's shift, still running. */
      continuing: running !== null,
      unclosed: unclosed ? attendanceResponse(unclosed) : null,
    };
  }

  async checkIn(user: User, dto: CheckInDto) {
    await this.access.assertPermission(user, dto.workspaceId, Permission.HrWrite);
    const { today: date, schedule } = await this.officeClock(dto.workspaceId);
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
    const dayIsWeekend = isWeekend(date, schedule);
    const now = new Date();
    const halfDay = await this.onHalfDayLeave(dto.workspaceId, user.id, date);
    const arrival = halfDay
      ? HALF_DAY_ARRIVAL
      : this.arrivalFigures(now, !isHoliday && !dayIsWeekend, schedule);
    const existing = await this.prisma.attendance.findFirst({
      where: { workspaceId: dto.workspaceId, userId: user.id, date },
    });
    // Still inside the shift that began yesterday: that one is closed first.
    // Starting a second day on top of it would leave the first open for good.
    if (!existing && (await this.continuingShift(dto.workspaceId, user.id, date))) {
      throw new BadRequestException(
        'You are still checked in from yesterday. Check out before starting a new day.',
      );
    }
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
    const { today: date, schedule } = await this.officeClock(dto.workspaceId);
    const record =
      (await this.prisma.attendance.findFirst({
        where: { workspaceId: dto.workspaceId, userId: user.id, date },
      })) ??
      // No row for today, but a shift that started yesterday and is still
      // running — the office's day turned over while they were at work.
      (await this.continuingShift(dto.workspaceId, user.id, date));
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
    const halfDay = await this.onHalfDayLeave(dto.workspaceId, user.id, record.date);
    const updated = await this.prisma.attendance.update({
      where: { id: record.id },
      data: {
        checkOutTime: now,
        workHours,
        // Same rule as the arrival: a day the office was shut had no expected
        // start, so closing it out grades the hours and can never come back
        // LATE. Without the flags here, check-out reinstated the very lateness
        // `arrivalFigures` had just declined to record. And a day with half of
        // it on approved leave closes as the half day it was.
        status: halfDay
          ? HALF_DAY_ARRIVAL.status
          : determineAttendanceStatus(
              record.checkInTime,
              now,
              workHours,
              !record.isHoliday && !record.isWeekend,
              schedule,
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
  constructor(
    prisma: PrismaService,
    access: WorkspaceAccessService,
    @Optional() private readonly holidayEvents?: EventEmitter2,
  ) {
    super(prisma, access);
  }
  protected map(row: Holiday) {
    return holidayResponse(row);
  }

  /**
   * The people whose approved leave a calendar change re-counted are told.
   * Their balance moved — a day handed back, or charged again — and the first
   * they knew was a different number on the Leave page.
   */
  private tellRecounted(
    user: User,
    workspaceId: string,
    reconciled: CalendarReconciliation,
    what: string,
  ): void {
    if (!reconciled.peopleCharged?.length) return;
    tellPeople(this.holidayEvents, {
      workspaceId,
      recipients: reconciled.peopleCharged,
      actorId: user.id,
      type: 'LEAVE_BALANCE_ADJUSTED',
      title: 'Leave re-counted for a holiday change',
      message: `${what}, so approved leave across it was counted again. Open Leave to see your balance.`,
      relatedEntityType: 'LEAVE',
    });
  }
  /**
   * Every write to the calendar and the re-count of the day (or days) whose
   * standing it may have changed are ONE transaction, under the workspace's
   * calendar lock — see calendar-lock.ts and holiday-reconcile.ts.
   *
   * They were two: the holiday committed, then the re-count ran on its own. A
   * failure between them (a dropped connection, a deploy) left a holiday on the
   * calendar with the leave across it still charged for the day, and nothing
   * ever re-ran it. And a leave request written in the same moment was counted
   * against the calendar from before the holiday, after the re-count had
   * already looked for it. The answer still says what the re-count did: leave
   * re-counted, days returned, attendance re-read.
   */
  async create(user: User, dto: CreateHolidayDto) {
    await this.access.assertPermission(user, dto.workspaceId, this.createPermission);
    const date = new Date(dto.date);
    const { row, reconciled } = await this.prisma.$transaction(
      async (tx) => {
        await lockCalendar(tx, dto.workspaceId);
        const row = await tx.holiday.create({
          data: {
            id: generateId(),
            workspaceId: dto.workspaceId,
            name: dto.name,
            date,
            isOptional: dto.isOptional ?? false,
            description: dto.description ?? '',
          },
        });
        return { row, reconciled: await reconcileCalendarDay(tx, dto.workspaceId, date) };
      },
      CALENDAR_TRANSACTION,
    );
    await this.recordAudit(user, dto.workspaceId, 'created', row.id, row);
    this.afterRecount(user, dto.workspaceId, reconciled, `${dto.name} on ${dto.date.slice(0, 10)} is now a holiday`);
    return { ...this.map(row), reconciled: summary(reconciled) };
  }
  async patch(user: User, id: string, dto: UpdateHolidayDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.isOptional !== undefined) data.isOptional = dto.isOptional;
    if (dto.description !== undefined) data.description = dto.description;
    const before = await this.findScoped(user, id);
    await this.access.assertPermission(user, before.workspaceId, this.updatePermission);
    await this.assertRowOwnership(user, before);
    // The day it was on and the day it is on: either may have changed standing.
    const days = new Map<number, Date>([[before.date.getTime(), before.date]]);
    if (data.date) days.set((data.date as Date).getTime(), data.date as Date);
    const { row, reconciled } = await this.prisma.$transaction(
      async (tx) => {
        await lockCalendar(tx, before.workspaceId);
        const row = await tx.holiday.update({ where: { id }, data });
        let reconciled: CalendarReconciliation = { attendanceRows: 0, leaveRequests: 0, daysReturned: 0 };
        for (const day of days.values()) {
          reconciled = mergeReconciliations(
            reconciled,
            await reconcileCalendarDay(tx, before.workspaceId, day),
          );
        }
        return { row, reconciled };
      },
      CALENDAR_TRANSACTION,
    );
    await this.recordAudit(user, before.workspaceId, 'updated', id, row, Object.keys(data));
    this.afterRecount(user, before.workspaceId, reconciled, `The holiday ${before.name} was changed`);
    return { ...this.map(row), reconciled: summary(reconciled) };
  }
  async remove(user: User, id: string): Promise<void> {
    const before = await this.findScoped(user, id);
    await this.access.assertPermission(user, before.workspaceId, this.writePermission);
    await this.assertRowOwnership(user, before);
    const reconciled = await this.prisma.$transaction(
      async (tx) => {
        await lockCalendar(tx, before.workspaceId);
        await tx.holiday.delete({ where: { id } });
        return reconcileCalendarDay(tx, before.workspaceId, before.date);
      },
      CALENDAR_TRANSACTION,
    );
    await this.recordAudit(user, before.workspaceId, 'deleted', id, before);
    this.afterRecount(
      user,
      before.workspaceId,
      reconciled,
      `${before.name} on ${before.date.toISOString().slice(0, 10)} is no longer a holiday`,
    );
  }

  /** Once the change has committed: the rows the write hook could not see are
   *  announced, and the people whose balance moved are told. */
  private afterRecount(
    user: User,
    workspaceId: string,
    reconciled: CalendarReconciliation,
    what: string,
  ): void {
    for (const written of reconciled.unannounced ?? []) {
      this.prisma.announceWrite?.(written.model, written.action, written.row);
    }
    this.tellRecounted(user, workspaceId, reconciled, what);
  }
}
