'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateLeaveRequest, useLeaveAvailability } from '@/hooks/use-leave';
import {
  LEAVE_TYPES,
  SELECTABLE_LEAVE_TYPES,
  type LeaveType,
  calculateLeaveDays,
  leaveDateBounds,
  validateLeaveDates,
  hasEnoughBalance,
} from '@/lib/leave-utils';
import { getBalanceFieldForLeaveType } from '@/lib/leave-balance-mapper';
import { parseDateOnly } from '@/lib/utils/working-days';
import { useHolidaySet } from '@/hooks/use-holidays';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface LeaveRequestFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  workspaceId: string;
}

export function LeaveRequestForm({ open, onOpenChange, userId, workspaceId }: LeaveRequestFormProps) {
  const [leaveType, setLeaveType] = React.useState<LeaveType>('CASUAL');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [validationError, setValidationError] = React.useState('');
  const [submitError, setSubmitError] = React.useState('');

  const createLeaveRequest = useCreateLeaveRequest();
  // The office's declared holidays: not working days, so not charged.
  const { holidays } = useHolidaySet(workspaceId);
  // The balance is charged to the year the leave STARTS in, so validate against
  // that year's row rather than whichever year it happens to be today.
  const targetYear = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? parseDateOnly(startDate).getFullYear()
    : undefined;
  // Availability, not the raw balance row: approval is what debits the row, so
  // days already committed to the member's own PENDING requests are still
  // sitting in `paidLeave`. The server subtracts them before it decides
  // (assertAffordable), and reading the row directly is what made this form
  // green-tick "✓ Sufficient balance available" for a request the submit then
  // refused with "Insufficient leave balance: 5 day(s) requested, 2 available."
  const {
    balance: leaveBalance,
    committed,
    available,
    isLoading: balanceLoading,
    isError: balanceError,
  } = useLeaveAvailability(workspaceId, targetYear);

  // Calculate days when dates change
  const calculatedDays = React.useMemo(() => {
    if (!startDate || !endDate) return 0;
    return calculateLeaveDays(startDate, endDate, leaveType, holidays);
  }, [startDate, endDate, leaveType, holidays]);

  // A half-day is a single session; keep the range collapsed so the preview and
  // the server agree.
  React.useEffect(() => {
    if (leaveType === 'HALF_DAY' && startDate) {
      setEndDate(startDate);
    }
  }, [leaveType, startDate]);

  // Get bookable balance for selected leave type using the mapper
  const balanceField = getBalanceFieldForLeaveType(leaveType);
  const availableBalance = React.useMemo(() => {
    if (!leaveBalance) return null;
    return Math.max(0, available[balanceField]);
  }, [leaveBalance, available, balanceField]);
  const committedUnits = leaveBalance ? committed[balanceField] : 0;

  // Check if user has enough balance. Unknown until the balance has loaded —
  // `null` keeps the form from claiming either "sufficient" or "insufficient".
  const sufficientBalance = React.useMemo(() => {
    if (!leaveBalance) return null;
    if (calculatedDays === 0) return true;

    // `available` is already the mapper-keyed record hasEnoughBalance expects,
    // with the pending commitments taken out.
    return hasEnoughBalance(leaveType, calculatedDays, available);
  }, [leaveType, calculatedDays, leaveBalance, available]);

  // Validate dates
  React.useEffect(() => {
    if (startDate && endDate) {
      const validation = validateLeaveDates(startDate, endDate, leaveType, holidays);
      if (!validation.valid) {
        setValidationError(validation.error || '');
      } else if (sufficientBalance === false) {
        // Same arithmetic the server reports back, so a user who submits anyway
        // does not get two different numbers for the same refusal.
        setValidationError(
          `Insufficient balance. You need ${calculatedDays} days but only ${availableBalance ?? 0} are available` +
            (committedUnits > 0
              ? ` — ${committedUnits} are already committed to requests awaiting approval.`
              : '.')
        );
      } else {
        setValidationError('');
      }
    } else {
      setValidationError('');
    }
  }, [
    startDate,
    endDate,
    leaveType,
    sufficientBalance,
    calculatedDays,
    availableBalance,
    committedUnits, holidays,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (validationError) {
      return;
    }

    if (reason.length < 10) {
      setValidationError('Reason must be at least 10 characters long');
      return;
    }

    try {
      await createLeaveRequest.mutateAsync({
        workspaceId,
        userId,
        leaveType,
        startDate,
        endDate,
        reason,
      });
    } catch (error) {
      // The mutation already toasts; keep the dialog open with the reason
      // inline so the user can correct and retry.
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit leave request');
      return;
    }

    // Reset form
    setLeaveType('CASUAL');
    setStartDate('');
    setEndDate('');
    setReason('');
    setValidationError('');
    onOpenChange(false);
  };

  // Selectable range, on the LOCAL calendar: from today — or, for leave that
  // is recorded after the fact, from a month back — to one year out.
  const { min: minDate, max: maxDate } = leaveDateBounds(leaveType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Leave</DialogTitle>
          <DialogDescription>
            Submit a leave request for manager approval. Make sure to provide all necessary details.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Leave Type */}
            <div className="space-y-2">
              <Label htmlFor="leaveType">Leave Type *</Label>
              <Select
                value={leaveType}
                onValueChange={(value) => setLeaveType(value as LeaveType)}
              >
                <SelectTrigger id="leaveType">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {[
                    ...Object.entries(SELECTABLE_LEAVE_TYPES),
                    // Earned, so only for somebody who has some to spend.
                    ...(leaveBalance && available.compOff > 0
                      ? ([['COMP_OFF', LEAVE_TYPES.COMP_OFF]] as Array<[string, string]>)
                      : []),
                  ].map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>
                  {leaveType === 'UNPAID' ? (
                    <>Unpaid leave has no balance limit</>
                  ) : balanceLoading ? (
                    <>Loading your balance…</>
                  ) : balanceError || availableBalance === null ? (
                    <>Balance unavailable</>
                  ) : (
                    <>
                      Available: <strong>{availableBalance}</strong>{' '}
                      {leaveType === 'HALF_DAY' ? 'half-day sessions' : 'days'}
                      {committedUnits > 0 && (
                        <> ({committedUnits} awaiting approval)</>
                      )}
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    // Auto-set end date to same as start date
                    if (!endDate || leaveType === 'HALF_DAY') {
                      setEndDate(e.target.value);
                    }
                  }}
                  min={minDate}
                  max={maxDate}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || minDate}
                  max={maxDate}
                  disabled={leaveType === 'HALF_DAY'}
                  required
                />
                {leaveType === 'HALF_DAY' && (
                  <p className="text-xs text-muted-foreground">
                    A half-day is a single session on the start date.
                  </p>
                )}
              </div>
            </div>

            {/* Calculated Days */}
            {calculatedDays > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {leaveType === 'HALF_DAY' ? (
                    <>
                      This leave request is for <strong>one half-day session</strong>.
                    </>
                  ) : (
                    <>
                      This leave request is for <strong>{calculatedDays}</strong>{' '}
                      {calculatedDays === 1 ? 'working day' : 'working days'}.
                    </>
                  )}
                  {sufficientBalance === true && leaveType !== 'UNPAID' && (
                    <span className="text-success-text ml-1">✓ Sufficient balance available</span>
                  )}
                  {sufficientBalance === false && (
                    <span className="text-destructive-text ml-1">✗ Insufficient balance</span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Validation Error */}
            {(validationError || submitError) && (
              <Alert variant="destructive">
                <AlertDescription>{validationError || submitError}</AlertDescription>
              </Alert>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason *</Label>
              <Textarea
                id="reason"
                placeholder="Please provide a detailed reason for your leave request..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                required
                minLength={10}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                {reason.length}/500 characters (minimum 10)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setValidationError('');
                setSubmitError('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createLeaveRequest.isPending ||
                balanceLoading ||
                !leaveBalance ||
                !!validationError ||
                calculatedDays === 0 ||
                reason.length < 10
              }
            >
              {createLeaveRequest.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
