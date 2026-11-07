import { LEAVE_REQUEST_TYPES, getBalanceFieldForLeaveType, type LeaveRequestType } from './leave-balance-mapper';
import {
  countWorkingDaysBetween,
  formatDateOnly,
  parseDateOnly,
  todayDateOnly,
  type HolidayDates,
} from './utils/working-days';

/**
 * Leave Management Utilities
 * Handles leave types, validation, balance calculations, and business logic
 */

// ============================================================================
// Leave Types and Constants
// ============================================================================

// Expose leave request type names from the balance mapper.
export const LEAVE_TYPES = LEAVE_REQUEST_TYPES;
export type LeaveType = LeaveRequestType;

/**
 * Types a member may always pick in the request form. COMP_OFF is not among
 * them: it is an EARNED balance, so the form offers it only to somebody who
 * has been granted some (Leave > Team Balances) — see `leaveTypeOptions` in
 * leave-request-form.tsx. Offered to everybody it only ever produced
 * "Insufficient balance"; offered to nobody, a granted day could not be taken.
 */
export const SELECTABLE_LEAVE_TYPES = Object.fromEntries(
  Object.entries(LEAVE_REQUEST_TYPES).filter(([key]) => key !== 'COMP_OFF')
) as Record<Exclude<LeaveType, 'COMP_OFF'>, string>;

export const LEAVE_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
} as const;

export type LeaveStatus = keyof typeof LEAVE_STATUS;

/** Default annual allocation the API seeds a member's first balance row with. */
export const DEFAULT_LEAVE_ALLOCATION = {
  paidLeave: 21,
  halfDay: 12,
  compOff: 0,
} as const;

/** Label lookups that tolerate a value the UI does not know about. */
export function getLeaveTypeLabel(leaveType: LeaveType): string {
  return LEAVE_TYPES[leaveType] || leaveType || 'Unknown';
}

export function getLeaveStatusLabel(status: LeaveStatus): string {
  return LEAVE_STATUS[status] || status || 'Unknown';
}

// ============================================================================
// Date and Balance Calculation Utilities
// ============================================================================

/**
 * Working days in an inclusive range of date-only strings. Delegates to the
 * canonical rule (Mon-Fri plus alternate working Saturdays) so leave durations
 * and attendance agree about what a working day is.
 */
export function calculateWorkingDays(
  startDate: string,
  endDate: string,
  holidays?: HolidayDates
): number {
  return countWorkingDaysBetween(startDate, endDate, holidays);
}

/**
 * Days a leave request costs. HALF_DAY is a single half-day session; every
 * other type is whole working days. The server derives the same number from the
 * stored range, so this is only the preview the form shows.
 */
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  leaveType?: LeaveType,
  /**
   * The workspace's declared holidays. The API leaves them out of what a
   * request costs; without them this preview said "5 working days" for a week
   * the request was then charged 4 for.
   */
  holidays?: HolidayDates
): number {
  if (leaveType === 'HALF_DAY') {
    return startDate === endDate ? 0.5 : 0;
  }
  return calculateWorkingDays(startDate, endDate, holidays);
}

/**
 * Check if user has sufficient leave balance
 */
export function hasEnoughBalance(
  leaveType: LeaveType,
  requestedDays: number,
  dbBalance: { paidLeave: number; unpaidLeave: number; halfDay: number; compOff: number }
): boolean {
  // Unpaid leave has no balance limit (unpaidLeave counts the days taken).
  if (leaveType === 'UNPAID') {
    return true;
  }

  // Get which DB field to check based on leave type
  const balanceField = getBalanceFieldForLeaveType(leaveType) as keyof typeof dbBalance;
  const balance = dbBalance[balanceField] || 0;

  // All leave types except HALF_DAY use full-day integers
  // HALF_DAY: always needs 1 unit
  // Others: need ceiling of days (enforced as full days now)
  const requiredAmount = leaveType === 'HALF_DAY' ? 1 : Math.ceil(requestedDays);

  return balance >= requiredAmount;
}

/**
 * Units a leave type charges its balance field: HALF_DAY is one session,
 * everything else is whole days. Mirrors the server's requiredUnits().
 */
export function requiredBalanceUnits(leaveType: LeaveType, requestedDays: number): number {
  return Math.max(0, leaveType === 'HALF_DAY' ? 1 : Math.ceil(requestedDays));
}

/**
 * Get leave type color for UI
 */
export function getLeaveTypeColor(leaveType: LeaveType): string {
  const colors: Record<LeaveType, string> = {
    CASUAL: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900',
    SICK: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900',
    ANNUAL: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900',
    MATERNITY: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950 dark:text-pink-200 dark:border-pink-900',
    PATERNITY: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-900',
    BEREAVEMENT: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-950 dark:text-slate-200 dark:border-slate-900',
    UNPAID: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-900',
    HALF_DAY: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900',
    COMP_OFF: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-900',
  };

  return colors[leaveType] || 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-900';
}

/**
 * Get leave status color for UI
 */
/*
 * `getLeaveStatusColor` was removed rather than kept.
 *
 * It handed back raw palette tints for a leave status, and leave statuses go through the
 * semantic Badge variants now -- see components/leave/leave-status-badge.tsx, which
 * documents why. Nothing called this any more. A dead helper that dispenses colours
 * contradicting the design system is not harmless: it is the obvious thing to reach for
 * next time a leave status needs a colour, which is how the divergence it caused arose in
 * the first place. Resolve a tone in lib/semantic/tone.ts instead.
 */

/**
 * Format leave date range for display
 */
export function formatLeaveDateRange(startDate: string, endDate: string): string {
  // The API returns date-only strings; parse them on the LOCAL calendar so the
  // rendered day matches the day that was requested.
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  };

  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString('en-US', options);
  }

  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}

/**
 * Leave that is not planned, and so may be recorded after it has begun — and
 * for how many days afterwards. The API enforces the same two values
 * (AFTER_THE_FACT_LEAVE / AFTER_THE_FACT_DAYS in leave.services.ts).
 */
const AFTER_THE_FACT_LEAVE: ReadonlySet<string> = new Set(['SICK', 'BEREAVEMENT', 'UNPAID']);
export const AFTER_THE_FACT_DAYS = 30;

export const canBeRecordedAfterwards = (leaveType?: LeaveType): boolean =>
  Boolean(leaveType) && AFTER_THE_FACT_LEAVE.has(String(leaveType));

/**
 * The earliest / latest date the form may offer, from the workspace's business
 * day (not the browser's clock).
 *
 * Earliest: today, or for leave that is not planned, up to
 * AFTER_THE_FACT_DAYS before it — nobody could record through the form that
 * they had been ill yesterday, which is when sickness is reported.
 *
 * Latest: the end of next year. Leave is charged to the year it starts in and
 * balances are kept for this year and the next (isAllowedBalanceYear in the
 * API). The form used to say "a year from today", which disagreed with the API
 * on both sides of that date.
 */
export function leaveDateBounds(leaveType?: LeaveType): { min: string; max: string } {
  const today = parseDateOnly(todayDateOnly());
  const min = new Date(today);
  if (canBeRecordedAfterwards(leaveType)) min.setDate(min.getDate() - AFTER_THE_FACT_DAYS);
  const max = new Date(today.getFullYear() + 1, 11, 31);
  return { min: formatDateOnly(min), max: formatDateOnly(max) };
}

/** The longest range one request may cover, as the API counts it (MAX_LEAVE_RANGE_DAYS). */
const MAX_LEAVE_RANGE_DAYS = 366;

/**
 * Validate leave request dates
 */
export function validateLeaveDates(
  startDate: string,
  endDate: string,
  leaveType?: LeaveType,
  holidays?: HolidayDates
): { valid: boolean; error?: string } {
  // Date-only strings are parsed on the LOCAL calendar; `new Date('YYYY-MM-DD')`
  // is UTC midnight, which reads as the previous local day west of UTC and made
  // today's date fail the past-date check.
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  // Check if end date is before start date
  if (end < start) {
    return { valid: false, error: 'End date cannot be before start date' };
  }

  // Planned leave is asked for ahead; the kinds that are not planned can be
  // recorded for a while afterwards. Same rule, same words, as the API.
  const earliest = parseDateOnly(leaveDateBounds(leaveType).min);
  if (start < earliest) {
    return {
      valid: false,
      error: canBeRecordedAfterwards(leaveType)
        ? `Leave can be recorded up to ${AFTER_THE_FACT_DAYS} days after the fact`
        : 'This kind of leave has to be requested before it starts. Sick, bereavement and unpaid leave can be recorded afterwards.',
    };
  }

  // The API's two limits, in its words.
  if (start > parseDateOnly(leaveDateBounds(leaveType).max)) {
    return { valid: false, error: 'Leave can be booked up to the end of next year.' };
  }
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_LEAVE_RANGE_DAYS) {
    return { valid: false, error: 'A leave request cannot span more than a year.' };
  }

  // A half-day is one session, so it cannot span a range.
  if (leaveType === 'HALF_DAY' && startDate !== endDate) {
    return { valid: false, error: 'A half-day leave must start and end on the same day' };
  }

  // A range made entirely of weekends costs nothing and the server rejects it —
  // say so instead of silently disabling Submit.
  if (calculateWorkingDays(startDate, endDate, holidays) === 0) {
    return { valid: false, error: 'The selected dates contain no working days' };
  }

  return { valid: true };
}
