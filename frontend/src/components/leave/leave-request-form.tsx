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
import { Checkbox } from '@/components/ui/checkbox';
import { useCreateLeaveRequest, useLeaveBalance } from '@/hooks/use-leave';
import {
  LEAVE_TYPES,
  type LeaveType,
  calculateLeaveDays,
  validateLeaveDates,
  hasEnoughBalance,
} from '@/lib/leave-utils';
import { getBalanceFieldForLeaveType } from '@/lib/leave-balance-mapper';
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
  const [halfDay, setHalfDay] = React.useState(false);
  const [emergencyContact, setEmergencyContact] = React.useState('');
  const [validationError, setValidationError] = React.useState('');

  const createLeaveRequest = useCreateLeaveRequest();
  const { data: leaveBalance } = useLeaveBalance(userId, workspaceId);

  // Calculate days when dates change
  const calculatedDays = React.useMemo(() => {
    if (!startDate || !endDate) return 0;
    return calculateLeaveDays(startDate, endDate, halfDay, leaveType);
  }, [startDate, endDate, halfDay, leaveType]);

  // Reset halfDay when leave type changes to non-HALF_DAY
  React.useEffect(() => {
    if (leaveType !== 'HALF_DAY') {
      setHalfDay(false);
    }
  }, [leaveType]);

  // Get available balance for selected leave type using the mapper
  const availableBalance = React.useMemo(() => {
    if (!leaveBalance) return 0;
    
    // Use mapper to get correct DB field
    const balanceField = getBalanceFieldForLeaveType(leaveType);
    return leaveBalance[balanceField] || 0;
  }, [leaveBalance, leaveType]);

  // Check if user has enough balance
  const sufficientBalance = React.useMemo(() => {
    if (!leaveBalance || calculatedDays === 0) return true;
    
    // Use mapper-aware balance checking
    const dbBalance = {
      paidLeave: leaveBalance.paidLeave || 0,
      unpaidLeave: leaveBalance.unpaidLeave || 0,
      halfDay: leaveBalance.halfDay || 0,
      compOff: leaveBalance.compOff || 0,
    };
    
    return hasEnoughBalance(leaveType, calculatedDays, dbBalance);
  }, [leaveType, calculatedDays, leaveBalance]);

  // Validate dates
  React.useEffect(() => {
    if (startDate && endDate) {
      const validation = validateLeaveDates(startDate, endDate);
      if (!validation.valid) {
        setValidationError(validation.error || '');
      } else if (!sufficientBalance) {
        setValidationError(
          `Insufficient balance. You need ${calculatedDays} days but have ${availableBalance} days remaining.`
        );
      } else {
        setValidationError('');
      }
    } else {
      setValidationError('');
    }
  }, [startDate, endDate, sufficientBalance, calculatedDays, availableBalance]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (validationError) {
      return;
    }

    if (reason.length < 10) {
      setValidationError('Reason must be at least 10 characters long');
      return;
    }

    await createLeaveRequest.mutateAsync({
      workspaceId,
      userId,
      leaveType,
      startDate,
      endDate,
      reason,
      halfDay,
      emergencyContact: emergencyContact || undefined,
    });

    // Reset form
    setLeaveType('CASUAL');
    setStartDate('');
    setEndDate('');
    setReason('');
    setHalfDay(false);
    setEmergencyContact('');
    setValidationError('');
    onOpenChange(false);
  };

  // Get minimum date (today)
  const minDate = new Date().toISOString().split('T')[0];

  // Get maximum date (1 year from now)
  const maxDate = new Date(
    new Date().setFullYear(new Date().getFullYear() + 1)
  )
    .toISOString()
    .split('T')[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                  {Object.entries(LEAVE_TYPES).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>
                  Available: <strong>{availableBalance}</strong> days
                </span>
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    // Auto-set end date to same as start date
                    if (!endDate) {
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
                  required
                />
              </div>
            </div>

            {/* Half Day Option - Only for HALF_DAY leave type */}
            {startDate && endDate && startDate === endDate && leaveType === 'HALF_DAY' && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="halfDay"
                  checked={halfDay}
                  onCheckedChange={(checked) => setHalfDay(checked as boolean)}
                />
                <Label
                  htmlFor="halfDay"
                  className="text-sm font-normal cursor-pointer"
                >
                  This is a half-day leave
                </Label>
              </div>
            )}

            {/* Calculated Days */}
            {calculatedDays > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This leave request is for <strong>{calculatedDays}</strong>{' '}
                  {calculatedDays === 1 ? 'working day' : 'working days'}.
                  {sufficientBalance ? (
                    <span className="text-green-600 ml-1">
                      ✓ Sufficient balance available
                    </span>
                  ) : (
                    <span className="text-red-600 ml-1">
                      ✗ Insufficient balance
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Validation Error */}
            {validationError && (
              <Alert variant="destructive">
                <AlertDescription>{validationError}</AlertDescription>
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

            {/* Emergency Contact */}
            <div className="space-y-2">
              <Label htmlFor="emergencyContact">Emergency Contact (Optional)</Label>
              <Input
                id="emergencyContact"
                type="tel"
                placeholder="+1 234 567 8900"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A phone number where you can be reached during your leave
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
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createLeaveRequest.isPending ||
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
