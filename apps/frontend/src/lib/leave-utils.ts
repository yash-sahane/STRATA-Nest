import { LEAVE_REQUEST_TYPES, getBalanceFieldForLeaveType, type LeaveRequestType } from './leave-balance-mapper';
import {
  countWorkingDaysBetween,
  formatDateOnly,
  parseDateOnly,
  todayDateOnly,
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
 * Types a member may pick in the request form. COMP_OFF is excluded: it is an
 * EARNED balance and nothing in the product credits it yet, so offering it only
 * ever produces "Insufficient balance". Existing COMP_OFF records still render.
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
export function calculateWorkingDays(startDate: string, endDate: string): number {
  return countWorkingDaysBetween(startDate, endDate);
}

/**
 * Days a leave request costs. HALF_DAY is a single half-day session; every
 * other type is whole working days. The server derives the same number from the
 * stored range, so this is only the preview the form shows.
 */
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  leaveType?: LeaveType
): number {
  if (leaveType === 'HALF_DAY') {
    return startDate === endDate ? 0.5 : 0;
  }
  return calculateWorkingDays(startDate, endDate);
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
 * Calculate leave utilization percentage
 */
export function calculateLeaveUtilization(
  used: number,
  total: number
): number {
  if (total === 0) return 0;
  return Math.round((used / total) * 100);
}

/**
 * Get leave balance status (low, medium, high)
 */
export function getLeaveBalanceStatus(
  remaining: number,
  total: number
): 'low' | 'medium' | 'high' {
  const percentage = (remaining / total) * 100;

  if (percentage <= 25) return 'low';
  if (percentage <= 50) return 'medium';
  return 'high';
}

/** The earliest / latest date the form may offer, on the LOCAL calendar. */
export function leaveDateBounds(): { min: string; max: string } {
  const max = new Date();
  max.setFullYear(max.getFullYear() + 1);
  return { min: todayDateOnly(), max: formatDateOnly(max) };
}

/**
 * Validate leave request dates
 */
export function validateLeaveDates(
  startDate: string,
  endDate: string,
  leaveType?: LeaveType
): { valid: boolean; error?: string } {
  // Date-only strings are parsed on the LOCAL calendar; `new Date('YYYY-MM-DD')`
  // is UTC midnight, which reads as the previous local day west of UTC and made
  // today's date fail the past-date check.
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const today = parseDateOnly(todayDateOnly());

  // Check if dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  // Check if end date is before start date
  if (end < start) {
    return { valid: false, error: 'End date cannot be before start date' };
  }

  // Check if start date is in the past (for non-emergency leaves)
  if (start < today) {
    return { valid: false, error: 'Start date cannot be in the past' };
  }

  // Check if leave is too far in the future (e.g., more than 1 year)
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  if (start > oneYearFromNow) {
    return { valid: false, error: 'Leave cannot be requested more than 1 year in advance' };
  }

  // A half-day is one session, so it cannot span a range.
  if (leaveType === 'HALF_DAY' && startDate !== endDate) {
    return { valid: false, error: 'A half-day leave must start and end on the same day' };
  }

  // A range made entirely of weekends costs nothing and the server rejects it —
  // say so instead of silently disabling Submit.
  if (leaveType !== 'HALF_DAY' && calculateWorkingDays(startDate, endDate) === 0) {
    return { valid: false, error: 'The selected dates contain no working days' };
  }

  return { valid: true };
}
