import { generateId } from '@strata/common';
import { workScheduleOf, workingSaturdaysOn, type WorkingWeekPeriod } from '@strata/config';
import type { Attendance, LeaveRequest, Prisma } from '@prisma/client';
import {
  calculateLateMinutes,
  determineAttendanceStatus,
  isLateCheckIn,
} from '../attendance/attendance-compute';
import {
  LEAVE_TYPE_TO_BALANCE_FIELD,
  OPEN_LEAVE_STATUSES,
  countWorkingDays,
  dateOnlyKey,
  ensureLeaveBalance,
  isNonWorkingDay,
  requiredUnits,
} from './leave-balance';

/** What changing the calendar changed for the people it covers. */
export interface CalendarReconciliation {
  /** Attendance rows re-read against the day as it now stands. */
  attendanceRows: number;
  /** Leave requests that became a day shorter or longer. */
  leaveRequests: number;
  /** Days given back to people's balances; negative when days were charged. */
  daysReturned: number;
  /** Whose approved leave — and so whose balance — this re-counted. */
  peopleCharged?: string[];
  /**
   * Rows written by statements the realtime write hook cannot see (a
   * conditional `updateMany`, a `createManyAndReturn`), for the caller to
   * announce once the transaction has committed.
   */
  unannounced?: Array<{ model: 'LeaveRequest' | 'Attendance'; action: 'create' | 'update'; row: unknown }>;
}

const nothing = (): CalendarReconciliation => ({ attendanceRows: 0, leaveRequests: 0, daysReturned: 0 });

/** Two re-counts of one calendar change, added together. */
export function mergeReconciliations(
  a: CalendarReconciliation,
  b: CalendarReconciliation,
): CalendarReconciliation {
  const people = [...new Set([...(a.peopleCharged ?? []), ...(b.peopleCharged ?? [])])];
  const unannounced = [...(a.unannounced ?? []), ...(b.unannounced ?? [])];
  return {
    attendanceRows: a.attendanceRows + b.attendanceRows,
    leaveRequests: a.leaveRequests + b.leaveRequests,
    daysReturned: a.daysReturned + b.daysReturned,
    ...(people.length ? { peopleCharged: people } : {}),
    ...(unannounced.length ? { unannounced } : {}),
  };
}

/** Statuses the server worked out from the clock, and may work out again. */
const DERIVED = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'HOLIDAY']);

/** What a request costs. A request that covers no working day costs nothing. */
const unitsFor = (type: string, days: number): number => (days > 0 ? requiredUnits(type, days) : 0);

/** How many times one request is re-read when it changes under the re-count. */
const ATTEMPTS = 3;

/**
 * Make everything already recorded for one day agree with the calendar as it
 * now stands — its holidays and its working week.
 *
 * The calendar decides two things: how many days a leave request costs, and
 * whether an arrival can be late. Both were applied only at the moment a row
 * was written. So a holiday declared AFTER somebody's leave across it had been
 * approved still cost them the day, a marker went on saying they were on leave
 * on a day the office was shut, and anybody who had checked in that morning
 * stayed "late". Removing a holiday left the reverse; so does a Saturday the
 * workspace starts or stops working.
 *
 * Idempotent, and read off the calendar rather than told what happened: it
 * asks whether the office is shut on `date` and brings the day into line, so it
 * can be run after a holiday is added, removed, moved or made optional, or the
 * working week changed, alike.
 *
 * Runs on the caller's transaction — the one that changed the calendar, under
 * `lockCalendar` — so the change and its consequences commit together or not
 * at all. A holiday saved and then not re-counted (a failure between two
 * separate commits) left leave charged for a day the calendar called shut.
 *
 * Leave: a pending request is simply re-counted. An approved one is re-counted
 * AND settled — the day comes back to the balance it was taken from, or is
 * charged to it when the day becomes a working day again. A charge never takes
 * a balance below zero: the leave was agreed, and the calendar changing
 * afterwards is not a reason to refuse it.
 */
export async function reconcileCalendarDay(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  date: Date,
): Promise<CalendarReconciliation> {
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: { settings: true },
  });
  const schedule = workScheduleOf(workspace?.settings);
  const weekend = isNonWorkingDay(date, schedule);
  const holiday =
    (await tx.holiday.count({ where: { workspaceId, date, isOptional: false } })) > 0;
  // Shut either way: nobody is expected in, and no leave is taken.
  const closed = weekend || holiday;
  const result = nothing();
  const unannounced: NonNullable<CalendarReconciliation['unannounced']> = [];

  // ---- attendance filed on the day -----------------------------------------
  for (const row of await tx.attendance.findMany({ where: { workspaceId, date } })) {
    // The marker an approved leave leaves behind: no real check-in.
    const leaveMarker =
      row.status === 'ON_LEAVE' &&
      !row.checkOutTime &&
      row.checkInTime.getTime() === row.date.getTime();
    if (leaveMarker) {
      // Nobody is on leave on a day the office is shut.
      if (closed) {
        await tx.attendance.delete({ where: { id: row.id } });
        result.attendanceRows += 1;
      }
      continue;
    }
    if (row.isHoliday === holiday && row.isWeekend === weekend) continue;

    const data: Prisma.AttendanceUpdateInput = { isHoliday: holiday, isWeekend: weekend };
    // Only what the clock decided is decided again. A status somebody stated
    // — an absence, leave filed by hand — stays as stated; the flags above are
    // what keep the day out of the working-day counts.
    if (DERIVED.has(row.status)) {
      const officeOpen = !closed;
      data.lateMinutes = officeOpen ? calculateLateMinutes(row.checkInTime, schedule) : 0;
      data.status = row.checkOutTime
        ? determineAttendanceStatus(
            row.checkInTime,
            row.checkOutTime,
            row.workHours ?? 0,
            officeOpen,
            schedule,
          )
        : officeOpen && isLateCheckIn(row.checkInTime, schedule)
          ? 'LATE'
          : 'PRESENT';
    }
    await tx.attendance.update({ where: { id: row.id }, data });
    result.attendanceRows += 1;
  }

  // ---- leave that covers the day -------------------------------------------
  const requests = await tx.leaveRequest.findMany({
    where: {
      workspaceId,
      status: { in: OPEN_LEAVE_STATUSES },
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });
  for (const found of requests) {
    let current: LeaveRequest | null = found;
    for (let attempt = 0; attempt < ATTEMPTS && current; attempt += 1) {
      const request: LeaveRequest = current;
      const holidays = new Set(
        (
          await tx.holiday.findMany({
            where: {
              workspaceId,
              isOptional: false,
              date: { gte: request.startDate, lte: request.endDate },
            },
            select: { date: true },
          })
        ).map((h) => dateOnlyKey(h.date)),
      );
      // Every day of the range by the rule in force ON it, so a re-count for a
      // change in the working week leaves the days before the change as they
      // were counted.
      const workingDays = countWorkingDays(request.startDate, request.endDate, holidays, schedule);
      const days = request.type === 'HALF_DAY' ? (workingDays > 0 ? 0.5 : 0) : workingDays;
      if (days === request.daysCount) break;

      // The change in what this leave is charged, as it will be applied.
      let moved = 0;
      let charge: { balanceId: string; data: Prisma.LeaveBalanceUpdateInput } | null = null;
      if (request.status === 'APPROVED') {
        // From what was actually CHARGED towards what the leave now costs — not
        // from the old day count. The two part whenever a re-count can only
        // partly be charged (below), and working from the day count then gave
        // back, on a later re-count or a cancellation, days nobody had paid for.
        const wanted = unitsFor(request.type, days) - request.chargedUnits;
        if (wanted !== 0) {
          // Charged to the year the leave is taken in, as approval charges it.
          const balance = await ensureLeaveBalance(
            tx,
            workspaceId,
            request.userId,
            request.startDate.getUTCFullYear(),
          );
          const field = LEAVE_TYPE_TO_BALANCE_FIELD[request.type] ?? 'paidLeave';
          if (request.type === 'UNPAID') {
            // `unpaidLeave` counts days TAKEN: it rises with the charge, and a
            // refund cannot take it below zero.
            moved = wanted > 0 ? wanted : -Math.min(-wanted, balance.unpaidLeave);
            if (moved !== 0) {
              charge = { balanceId: balance.id, data: { unpaidLeave: { increment: moved } } };
            }
          } else {
            // A refund goes back in full. A further charge only as far as the
            // balance still covers it: the leave was agreed, and the calendar
            // changing afterwards is no reason to overdraw anybody.
            moved = wanted < 0 ? wanted : Math.min(wanted, Math.max(0, balance[field]));
            if (moved !== 0) {
              charge = {
                balanceId: balance.id,
                data: { [field]: { increment: -moved } } as Prisma.LeaveBalanceUpdateInput,
              };
            }
          }
        }
      }

      // Claimed on the figures it was counted from, like every other write to
      // a request's days. Leave writes queue behind the calendar lock, but a
      // rejection or a member's removal settles a request without counting
      // days, and an unconditional write here put back a day count — and a
      // charge — worked out from a request that had moved on.
      const claimed = await tx.leaveRequest.updateMany({
        where: {
          id: request.id,
          status: request.status,
          startDate: request.startDate,
          endDate: request.endDate,
          daysCount: request.daysCount,
          chargedUnits: request.chargedUnits,
        },
        data: {
          daysCount: days,
          ...(request.status === 'APPROVED' ? { chargedUnits: request.chargedUnits + moved } : {}),
        },
      });
      if (claimed.count === 0) {
        // Changed under the re-count: read it again, and count what it is now.
        current = await tx.leaveRequest.findUnique({ where: { id: request.id } });
        if (current && !OPEN_LEAVE_STATUSES.includes(current.status)) current = null;
        continue;
      }

      if (charge) {
        await tx.leaveBalance.update({ where: { id: charge.balanceId }, data: charge.data });
        result.daysReturned -= moved;
      }
      if (request.status === 'APPROVED') {
        result.peopleCharged = [...new Set([...(result.peopleCharged ?? []), request.userId])];
        // The day is a leave day again: put back the marker approval would
        // have written for it. A real check-in on the day is left alone.
        if (!closed && request.type !== 'HALF_DAY') {
          const markers: Attendance[] = await tx.attendance.createManyAndReturn({
            data: [
              {
                id: generateId(),
                workspaceId,
                userId: request.userId,
                date,
                checkInTime: date,
                status: 'ON_LEAVE',
                notes: `Approved ${request.type} leave`,
                createdById: request.userId,
                createdByName: request.createdByName,
              },
            ],
            skipDuplicates: true,
          });
          for (const marker of markers) {
            unannounced.push({ model: 'Attendance', action: 'create', row: marker });
          }
        }
      }
      const saved = await tx.leaveRequest.findUnique({ where: { id: request.id } });
      if (saved) unannounced.push({ model: 'LeaveRequest', action: 'update', row: saved });
      result.leaveRequests += 1;
      break;
    }
  }
  if (unannounced.length) result.unannounced = unannounced;
  return result;
}

/**
 * Bring the days from `fromDay` on into line with a working week that has just
 * changed — on the same transaction as the change, under `lockCalendar`.
 *
 * Only Saturdays can differ, and only those whose standing the change flips are
 * visited; past days keep the rule they were worked under (the history in
 * `workingWeek` says so), so nothing already settled moves. The visits stop at
 * the last day anything is recorded for: the furthest open leave, or the
 * latest attendance row (an approved leave's markers run ahead of today).
 */
export async function reconcileWorkingWeekChange(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  fromDay: Date,
  before: readonly WorkingWeekPeriod[],
  after: readonly WorkingWeekPeriod[],
): Promise<CalendarReconciliation> {
  const [leave, attendance] = await Promise.all([
    tx.leaveRequest.aggregate({
      where: { workspaceId, status: { in: OPEN_LEAVE_STATUSES }, endDate: { gte: fromDay } },
      _max: { endDate: true },
    }),
    tx.attendance.aggregate({
      where: { workspaceId, date: { gte: fromDay } },
      _max: { date: true },
    }),
  ]);
  const last = [leave._max.endDate, attendance._max.date]
    .filter((d): d is Date => d instanceof Date)
    .reduce<Date | null>((max, d) => (max === null || d > max ? d : max), null);
  let result = nothing();
  if (!last) return result;

  const worked = (day: Date, periods: readonly WorkingWeekPeriod[]) =>
    !isNonWorkingDay(day, { workingWeek: [...periods] });
  const cursor = new Date(fromDay.getTime());
  // To the first Saturday on or after the day the change applies from.
  cursor.setUTCDate(cursor.getUTCDate() + ((6 - cursor.getUTCDay() + 7) % 7));
  for (; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const day = new Date(cursor.getTime());
    if (worked(day, before) === worked(day, after)) continue;
    result = mergeReconciliations(result, await reconcileCalendarDay(tx, workspaceId, day));
  }
  return result;
}

/** Whether two working-week histories give every day from `fromDay` on the same rule. */
export function sameWorkingWeekFrom(
  fromDay: string,
  before: readonly WorkingWeekPeriod[],
  after: readonly WorkingWeekPeriod[],
): boolean {
  const days = new Set([fromDay, ...[...before, ...after].map((p) => p.from).filter((d) => d >= fromDay)]);
  return [...days].every((day) => {
    const a = workingSaturdaysOn(day, before);
    const b = workingSaturdaysOn(day, after);
    return a.length === b.length && a.every((week, i) => week === b[i]);
  });
}
