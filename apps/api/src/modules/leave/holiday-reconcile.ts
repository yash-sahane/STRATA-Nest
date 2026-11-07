import { generateId } from '@strata/common';
import { workScheduleOf } from '@strata/config';
import type { PrismaService } from '@strata/prisma';
import type { Prisma } from '@prisma/client';
import {
  calculateLateMinutes,
  determineAttendanceStatus,
  isLateCheckIn,
} from '../attendance/attendance-compute';
import {
  LEAVE_TYPE_TO_BALANCE_FIELD,
  countWorkingDays,
  dateOnlyKey,
  ensureLeaveBalance,
  isNonWorkingDay,
  requiredUnits,
} from './leave-balance';

/** What changing the calendar changed for the people it covers. */
export interface HolidayReconciliation {
  /** Attendance rows re-read against the day as it now stands. */
  attendanceRows: number;
  /** Leave requests that became a day shorter or longer. */
  leaveRequests: number;
  /** Days given back to people's balances; negative when days were charged. */
  daysReturned: number;
  /** Whose approved leave — and so whose balance — this re-counted. */
  peopleCharged?: string[];
}

const NOTHING: HolidayReconciliation = { attendanceRows: 0, leaveRequests: 0, daysReturned: 0 };

/** Statuses the server worked out from the clock, and may work out again. */
const DERIVED = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'HOLIDAY']);

/** What a request costs. A request that covers no working day costs nothing. */
const unitsFor = (type: string, days: number): number => (days > 0 ? requiredUnits(type, days) : 0);

/**
 * Make everything already recorded for one day agree with the calendar as it
 * now stands.
 *
 * The calendar decides two things: how many days a leave request costs, and
 * whether an arrival can be late. Both were applied only at the moment a row
 * was written. So a holiday declared AFTER somebody's leave across it had been
 * approved still cost them the day, a marker went on saying they were on leave
 * on a day the office was shut, and anybody who had checked in that morning
 * stayed "late". Removing a holiday left the reverse. The screen said as much
 * — "adjust the balance if it should not" — which is the application
 * describing its own gap and handing it to whoever was reading.
 *
 * Idempotent, and read off the calendar rather than told what happened: it
 * asks whether the office is shut on `date` and brings the day into line, so it
 * can be run after a holiday is added, removed, moved or made optional alike.
 *
 * Leave: a pending request is simply re-counted. An approved one is re-counted
 * AND settled — the day comes back to the balance it was taken from, or is
 * charged to it when a holiday is withdrawn. A charge never takes a balance
 * below zero: the leave was agreed, and the calendar changing afterwards is not
 * a reason to refuse it.
 */
export async function reconcileHolidayChange(
  prisma: PrismaService,
  workspaceId: string,
  date: Date,
): Promise<HolidayReconciliation> {
  // A weekend was never a working day, holiday or not: nothing turns on it.
  if (isNonWorkingDay(date)) return NOTHING;

  return prisma.$transaction(async (tx) => {
    const closed =
      (await tx.holiday.count({ where: { workspaceId, date, isOptional: false } })) > 0;
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { settings: true },
    });
    const schedule = workScheduleOf(workspace?.settings);
    const result: HolidayReconciliation = { attendanceRows: 0, leaveRequests: 0, daysReturned: 0 };

    // ---- attendance filed on the day ---------------------------------------
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
      if (row.isHoliday === closed) continue;

      const data: Prisma.AttendanceUpdateInput = { isHoliday: closed };
      // Only what the clock decided is decided again. A status somebody stated
      // — an absence, leave filed by hand — stays as stated; the flag above is
      // what keeps the day out of the working-day counts.
      if (DERIVED.has(row.status)) {
        const officeOpen = !closed && !row.isWeekend;
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

    // ---- leave that covers the day -----------------------------------------
    const requests = await tx.leaveRequest.findMany({
      where: {
        workspaceId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
    for (const request of requests) {
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
      const workingDays = countWorkingDays(request.startDate, request.endDate, holidays);
      const days = request.type === 'HALF_DAY' ? (workingDays > 0 ? 0.5 : 0) : workingDays;
      if (days === request.daysCount) continue;

      if (request.status === 'APPROVED') {
        const owed = unitsFor(request.type, request.daysCount) - unitsFor(request.type, days);
        if (owed !== 0) {
          // Charged to the year the leave is taken in, as approval charges it.
          const balance = await ensureLeaveBalance(
            tx,
            workspaceId,
            request.userId,
            request.startDate.getUTCFullYear(),
          );
          const field = LEAVE_TYPE_TO_BALANCE_FIELD[request.type] ?? 'paidLeave';
          // `unpaidLeave` counts days TAKEN, so it moves the other way.
          const delta =
            request.type === 'UNPAID'
              ? Math.max(-owed, -balance.unpaidLeave)
              : Math.max(owed, -balance[field]);
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: { [field]: { increment: delta } } as Prisma.LeaveBalanceUpdateInput,
          });
          result.daysReturned += request.type === 'UNPAID' ? -delta : delta;
          result.peopleCharged = [...new Set([...(result.peopleCharged ?? []), request.userId])];
        }
        // The day is a leave day again: put back the marker approval would
        // have written for it. A real check-in on the day is left alone.
        if (!closed && request.type !== 'HALF_DAY') {
          await tx.attendance.createMany({
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
        }
      }
      await tx.leaveRequest.update({ where: { id: request.id }, data: { daysCount: days } });
      result.leaveRequests += 1;
    }
    return result;
  });
}
