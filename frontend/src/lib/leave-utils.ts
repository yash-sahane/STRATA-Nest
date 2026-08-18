import { LEAVE_REQUEST_TYPES, getBalanceFieldForLeaveType, type LeaveRequestType } from './leave-balance-mapper';

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

export const LEAVE_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
} as const;

export type LeaveStatus = keyof typeof LEAVE_STATUS;

// ============================================================================
// Date and Balance Calculation Utilities
// ============================================================================

/**
 * Calculate number of working days between two dates (excluding weekends)
 */
export function calculateWorkingDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    // Skip Saturday (6) and Sunday (0)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
}

/**
 * Calculate leave days considering half-day option
 */
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  halfDay: boolean = false,
  leaveType?: LeaveType
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const workingDays = calculateWorkingDays(start, end);

  // Half-day is only allowed for HALF_DAY leave type
  // All other leave types must be full-day (INTEGER)
  if (leaveType && leaveType !== 'HALF_DAY') {
    return Math.ceil(workingDays); // Enforce full-day
  }

  if (halfDay && workingDays === 1) {
    return 0.5;
  }

  return workingDays;
}

/**
 * Check if user has sufficient leave balance
 */
export function hasEnoughBalance(
  leaveType: LeaveType,
  requestedDays: number,
  dbBalance: { paidLeave: number; unpaidLeave: number; halfDay: number; compOff: number }
): boolean {
  // Unpaid leave has no balance limit
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
 * Initialize default leave balance for a new user
 */
export function initializeLeaveBalance(): {
  paidLeave: number;
  unpaidLeave: number;
  halfDay: number;
  compOff: number;
} {
  return {
    paidLeave: 21,
    unpaidLeave: 0,
    halfDay: 12,
    compOff: 0,
  };
}

/**
 * Get leave type color for UI
 */
export function getLeaveTypeColor(leaveType: LeaveType): string {
  const colors: Record<LeaveType, string> = {
    CASUAL: 'bg-blue-100 text-blue-800 border-blue-200',
    SICK: 'bg-red-100 text-red-800 border-red-200',
    ANNUAL: 'bg-green-100 text-green-800 border-green-200',
    MATERNITY: 'bg-pink-100 text-pink-800 border-pink-200',
    PATERNITY: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    BEREAVEMENT: 'bg-slate-100 text-slate-800 border-slate-200',
    UNPAID: 'bg-gray-100 text-gray-800 border-gray-200',
    HALF_DAY: 'bg-amber-100 text-amber-800 border-amber-200',
    COMP_OFF: 'bg-purple-100 text-purple-800 border-purple-200',
  };

  return colors[leaveType] || 'bg-gray-100 text-gray-800 border-gray-200';
}

/**
 * Get leave status color for UI
 */
export function getLeaveStatusColor(status: LeaveStatus): string {
  const colors: Record<LeaveStatus, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    APPROVED: 'bg-green-100 text-green-800 border-green-200',
    REJECTED: 'bg-red-100 text-red-800 border-red-200',
    CANCELLED: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200';
}

/**
 * Format leave date range for display
 */
export function formatLeaveDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);

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

/**
 * Validate leave request dates
 */
export function validateLeaveDates(
  startDate: string,
  endDate: string
): { valid: boolean; error?: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  return { valid: true };
}
