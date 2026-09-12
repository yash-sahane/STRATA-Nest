/**
 * Leave type → balance field mapping, the working-day duration rule and the
 * required units used for server-side balance deduction on approval.
 */
import { generateId } from '@strata/common';
import type { LeaveBalance, Prisma } from '@prisma/client';
import { WORK_SCHEDULE } from '../attendance/attendance-compute';

export type LeaveBalanceField = 'paidLeave' | 'unpaidLeave' | 'halfDay' | 'compOff';

export const LEAVE_TYPE_TO_BALANCE_FIELD: Record<string, LeaveBalanceField> = {
  CASUAL: 'paidLeave',
  SICK: 'paidLeave',
  ANNUAL: 'paidLeave',
  MATERNITY: 'paidLeave',
  PATERNITY: 'paidLeave',
  BEREAVEMENT: 'paidLeave',
  UNPAID: 'unpaidLeave',
  HALF_DAY: 'halfDay',
  COMP_OFF: 'compOff',
};

/** The accepted leave types — the DTOs validate against this list, so an
 *  unknown type can never fall through to the paid pot. */
export const LEAVE_TYPES: string[] = Object.keys(LEAVE_TYPE_TO_BALANCE_FIELD);

/** Statuses that still reserve their dates (used for overlap detection). */
export const OPEN_LEAVE_STATUSES = ['PENDING', 'APPROVED'];

/** Allocation seeded the first time a member's balance row is provisioned.
 *  `unpaidLeave` is a counter of unpaid days taken, not an allowance. */
export const DEFAULT_LEAVE_ALLOCATION = {
  paidLeave: 21,
  unpaidLeave: 0,
  halfDay: 12,
  compOff: 0,
};

/** Longest range a single leave request may span. */
export const MAX_LEAVE_RANGE_DAYS = 366;

/**
 * Years a member may hold a balance for: the current one and the one either
 * side. `ensureLeaveBalance` provisions a full DEFAULT_LEAVE_ALLOCATION on
 * first touch, so an unbounded year let anyone mint fresh 21-day allowances by
 * naming a distant start date (and keep booking against them once the current
 * year was exhausted). `GET /leave_balances/me` already enforced this window;
 * the request paths must agree with it.
 */
export function isAllowedBalanceYear(year: number): boolean {
  const thisYear = new Date().getUTCFullYear();
  return Number.isInteger(year) && year >= thisYear - 1 && year <= thisYear + 1;
}

export const BALANCE_YEAR_MESSAGE =
  'year must be the current year, or the one either side of it.';

/** 'YYYY-MM-DD' (or the date part of an ISO string) at UTC midnight — the
 *  representation the date-only columns round-trip. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function weekOfMonth(d: Date): number {
  const firstDayOfWeek = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay();
  return Math.ceil((d.getUTCDate() + firstDayOfWeek) / 7);
}

/** Sunday always; Saturday except on the alternate working weeks — the same
 *  rule attendance applies (WORK_SCHEDULE), read in UTC because leave dates are
 *  date-only columns stored at UTC midnight. */
export function isNonWorkingDay(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0) return true;
  if (day === 6) return !WORK_SCHEDULE.ALTERNATE_SATURDAY_WEEKS.includes(weekOfMonth(d));
  return false;
}

/** 'YYYY-MM-DD' for a UTC-midnight date-only value — the key shape a holiday
 *  set is built from, so the two can be compared without re-parsing. */
export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Working days in an inclusive date-only range.
 *
 * `holidays` is a set of 'YYYY-MM-DD' keys. Without it a company holiday inside
 * a leave range was counted as a working day, so `requiredUnits` rounded it up
 * and the member was charged a day of their balance for a day the office was
 * shut. Optional so callers with no workspace context keep the weekend-only
 * rule, but LeaveRequestsService always passes one.
 */
export function countWorkingDays(start: Date, end: Date, holidays?: ReadonlySet<string>): number {
  let count = 0;
  const cursor = new Date(start.getTime());
  for (let i = 0; i <= MAX_LEAVE_RANGE_DAYS && cursor <= end; i += 1) {
    if (!isNonWorkingDay(cursor) && !holidays?.has(dateOnlyKey(cursor))) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

/** Units deducted on approval: HALF_DAY = 1 session; everything else =
 *  ceil(days). Never negative — a negative quantity would credit the balance. */
export function requiredUnits(type: string, daysCount: number): number {
  return Math.max(0, type === 'HALF_DAY' ? 1 : Math.ceil(daysCount));
}

/** Fetch (or provision) a member's balance row for a year. The
 *  `[workspaceId, userId, year]` unique key makes the upsert race-safe, so
 *  approval and self-service both land on the same row. */
export function ensureLeaveBalance(
  db: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  year: number,
): Promise<LeaveBalance> {
  return db.leaveBalance.upsert({
    where: { workspaceId_userId_year: { workspaceId, userId, year } },
    update: {},
    create: { id: generateId(), workspaceId, userId, year, ...DEFAULT_LEAVE_ALLOCATION },
  });
}
