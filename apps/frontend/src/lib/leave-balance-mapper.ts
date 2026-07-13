/**
 * Leave Balance Mapper
 * 
 * This is the SINGLE SOURCE OF TRUTH for mapping leave request types
 * to leave balance fields in the database.
 * 
 * Purpose: Separate business logic (leave types users see) from
 * accounting logic (which balance field to deduct from).
 * 
 * When to use: ONLY during leave approval, NOT during leave submission.
 */

/**
 * Leave request types (what users see in the UI)
 */
export const LEAVE_REQUEST_TYPES = {
  CASUAL: 'Casual Leave',
  SICK: 'Sick Leave',
  ANNUAL: 'Annual Leave',
  MATERNITY: 'Maternity Leave',
  PATERNITY: 'Paternity Leave',
  BEREAVEMENT: 'Bereavement Leave',
  UNPAID: 'Unpaid Leave',
  HALF_DAY: 'Half Day',
  COMP_OFF: 'Compensatory Off',
} as const;

export type LeaveRequestType = keyof typeof LEAVE_REQUEST_TYPES;

/**
 * Leave balance fields (what exists in the database)
 * 
 * Note: halfDay represents INTEGER count of half-day leave units, not fractional days
 * Example: 12 → 11 → 10 (each unit is one half-day session)
 */
export type LeaveBalanceField = 'paidLeave' | 'unpaidLeave' | 'halfDay' | 'compOff';

/**
 * THE MAPPING LAYER
 * 
 * Maps leave request types to balance fields.
 * This determines which balance gets deducted during approval.
 * 
 * IMPORTANT: Deduction is based on LEAVE TYPE, not duration.
 * - ANNUAL/CASUAL/SICK with half-day duration → deducts from paidLeave (0.5 days)
 * - HALF_DAY leave type → deducts from halfDay (1 unit, regardless of duration)
 */
export const LEAVE_TYPE_TO_BALANCE_FIELD: Record<LeaveRequestType, LeaveBalanceField> = {
  CASUAL: 'paidLeave',
  SICK: 'paidLeave',
  ANNUAL: 'paidLeave',
  MATERNITY: 'paidLeave',
  PATERNITY: 'paidLeave',
  BEREAVEMENT: 'paidLeave',
  UNPAID: 'unpaidLeave',
  HALF_DAY: 'halfDay',
  COMP_OFF: 'compOff',
} as const;

/**
 * Helper: Get which balance field to deduct from
 */
export function getBalanceFieldForLeaveType(leaveType: LeaveRequestType): LeaveBalanceField {
  return LEAVE_TYPE_TO_BALANCE_FIELD[leaveType];
}

/**
 * Helper: Get the display name for a leave type
 */
export function getLeaveTypeDisplayName(leaveType: LeaveRequestType): string {
  return LEAVE_REQUEST_TYPES[leaveType];
}

/**
 * Helper: Get the display name for a balance field
 */
export function getBalanceFieldDisplayName(field: LeaveBalanceField): string {
  const displayNames: Record<LeaveBalanceField, string> = {
    paidLeave: 'Paid Leave',
    unpaidLeave: 'Unpaid Leave',
    halfDay: 'Half Day',
    compOff: 'Compensatory Off',
  };
  return displayNames[field];
}
