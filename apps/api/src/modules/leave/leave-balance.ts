/**
 * Leave type → balance field mapping + required units used for server-side
 * balance deduction on approval.
 */
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

/** Units deducted on approval: HALF_DAY = 1; everything else = ceil(days). */
export function requiredUnits(type: string, daysCount: number): number {
  return type === 'HALF_DAY' ? 1 : Math.ceil(daysCount);
}
