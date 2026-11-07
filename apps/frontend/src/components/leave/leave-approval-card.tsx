'use client';

import * as React from 'react';
import { Check, X, Calendar, User, Clock, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useApproveLeave,
  useCancelLeaveRequest,
  useRejectLeave,
  type LeaveRequest,
} from '@/hooks/use-leave';
import { useConfirm } from '@/components/providers/confirm-provider';
import { parseDateOnly, todayDateOnly } from '@/lib/utils/working-days';
import {
  getLeaveTypeLabel,
  getLeaveTypeColor,
  formatLeaveDateRange,
} from '@/lib/leave-utils';
import { LeaveStatusBadge } from '@/components/leave/leave-status-badge';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';

interface LeaveApprovalCardProps {
  leaveRequest: LeaveRequest;
  approverId: string;
  approverName: string;
}

export function LeaveApprovalCard({
  leaveRequest,
  approverId,
  approverName,
}: LeaveApprovalCardProps) {
  const mailDelivers = useAuth().user?.mailDelivers !== false;
  const [showApproveDialog, setShowApproveDialog] = React.useState(false);
  const [showRejectDialog, setShowRejectDialog] = React.useState(false);
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [decisionError, setDecisionError] = React.useState('');

  const approveLeave = useApproveLeave();
  const rejectLeave = useRejectLeave();
  const cancelLeave = useCancelLeaveRequest();
  const confirm = useConfirm();

  /**
   * Approved leave that has not ended can still be changed by whoever approves
   * leave: cancelled before it starts, ended early while it runs. These cards
   * carried no control at all, so somebody back early stayed "on leave" to the
   * last day, charged for days they worked.
   */
  const today = parseDateOnly(todayDateOnly());
  // Its first day counts as started, as the API counts it: "Cancel Leave" on
  // the morning of somebody's day off handed that day back to their balance.
  const started = parseDateOnly(leaveRequest.startDate) <= today;
  const startsToday = parseDateOnly(leaveRequest.startDate).getTime() === today.getTime();
  const over = parseDateOnly(leaveRequest.endDate) < today;
  const person = leaveRequest.userName || 'This person';
  const handleWithdraw = async () => {
    const proceed = await confirm(
      started
        ? {
            title: 'End this leave early?',
            description: startsToday
              ? `${person}'s leave began today, so ending it now withdraws it: they are back today, all its days go back to their balance and come off the calendar, and they are told.`
              : `${person}'s leave will end yesterday. The days not taken go back to their balance and come off the calendar, and they are told.`,
            confirmText: 'End Early',
            cancelText: 'Keep It',
            destructive: true,
          }
        : {
            title: 'Cancel this leave?',
            description: `${person}'s approved leave is withdrawn and the days go back to their balance. They are told.`,
            confirmText: 'Cancel Leave',
            cancelText: 'Keep It',
            destructive: true,
          }
    );
    if (proceed) cancelLeave.mutate(leaveRequest.id);
  };

  const handleApprove = async () => {
    setDecisionError('');
    try {
      await approveLeave.mutateAsync({
        leaveRequestId: leaveRequest.id,
        approverId,
        approverName,
      });
    } catch (error) {
      // Keep the dialog open so the manager sees why the decision failed.
      setDecisionError(error instanceof Error ? error.message : 'Failed to approve leave request');
      return;
    }
    setShowApproveDialog(false);
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      return;
    }

    setDecisionError('');
    try {
      await rejectLeave.mutateAsync({
        leaveRequestId: leaveRequest.id,
        approverId,
        approverName,
        rejectionReason,
      });
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Failed to reject leave request');
      return;
    }
    setShowRejectDialog(false);
    setRejectionReason('');
  };

  const isPending = leaveRequest.status === 'PENDING';
  const isApproved = leaveRequest.status === 'APPROVED';
  const isRejected = leaveRequest.status === 'REJECTED';

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {leaveRequest.userName || 'Unknown User'}
              </CardTitle>
              <CardDescription className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                {formatLeaveDateRange(leaveRequest.startDate, leaveRequest.endDate)}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* Semantic variant, shared with the pending count on the tab
                  above — see LeaveStatusBadge. The TYPE badge below stays a
                  soft outline tint on purpose: status is the loud signal, the
                  leave type is quiet metadata beside it. */}
              <LeaveStatusBadge status={leaveRequest.status} />
              <Badge className={getLeaveTypeColor(leaveRequest.leaveType)} variant="outline">
                {getLeaveTypeLabel(leaveRequest.leaveType)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Duration:</span>
              <span className="font-medium">
                {leaveRequest.leaveType === 'HALF_DAY'
                  ? 'Half day'
                  : `${leaveRequest.days} ${leaveRequest.days === 1 ? 'day' : 'days'}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Requested:</span>
              <span className="font-medium">
                {formatDate(leaveRequest.createdAt)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Reason:</Label>
            <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
              {leaveRequest.reason}
            </p>
          </div>

          {leaveRequest.rejectionReason && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Rejection Reason:</Label>
              <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
                {leaveRequest.rejectionReason}
              </p>
            </div>
          )}
        </CardContent>
        {isPending && (
          <CardFooter className="flex gap-2">
            {/* Same variants as the confirmation dialogs these open, so the
                card and its dialog agree, and both stay on the tokens. */}
            <Button
              variant="outline"
              className="flex-1 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
              onClick={() => setShowRejectDialog(true)}
            >
              <X className="mr-2 h-4 w-4" />
              Reject
            </Button>
            <Button
              variant="success"
              className="flex-1"
              onClick={() => setShowApproveDialog(true)}
            >
              <Check className="mr-2 h-4 w-4" />
              Approve
            </Button>
          </CardFooter>
        )}
        {(isApproved || isRejected) && (
          <CardFooter className="flex flex-col gap-2">
            {isApproved && !over && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={cancelLeave.isPending}
                onClick={handleWithdraw}
              >
                {started ? 'End Early' : 'Cancel Leave'}
              </Button>
            )}
            <div className="text-xs text-muted-foreground w-full text-center">
              {isApproved ? 'Approved' : 'Rejected'}
              {leaveRequest.approvedAt &&
                ` on ${formatDate(leaveRequest.approvedAt)}`}
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Approve Dialog */}
      {/* Clear on close: Escape, outside-click and the X all route through
          onOpenChange and never fire the Cancel button's handler, so one
          dialog's failure ("Insufficient leave balance") was still on screen
          when the OTHER opened, before any decision had been attempted. */}
      <Dialog
        open={showApproveDialog}
        onOpenChange={(next) => {
          setShowApproveDialog(next);
          if (!next) setDecisionError('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Leave Request</DialogTitle>
            <DialogDescription>
              You are about to approve {leaveRequest.userName}&apos;s leave request for{' '}
              {leaveRequest.days} {leaveRequest.days === 1 ? 'day' : 'days'}. The balance will be
              deducted and the employee will be notified.
            </DialogDescription>
          </DialogHeader>
          {decisionError && (
            <p className="text-sm text-destructive-text">{decisionError}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowApproveDialog(false);
                setDecisionError('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="success"
              onClick={handleApprove}
              disabled={approveLeave.isPending}
            >
              {approveLeave.isPending ? 'Approving...' : 'Approve Leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={showRejectDialog}
        onOpenChange={(next) => {
          setShowRejectDialog(next);
          if (!next) setDecisionError('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
            <DialogDescription>
              You are about to reject {leaveRequest.userName}&apos;s leave request. Give the
              reason: they are told it in the app{mailDelivers ? ', and by email' : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rejectionReason">Rejection Reason *</Label>
              <Textarea
                id="rejectionReason"
                placeholder="Please explain why this leave request is being rejected..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={4}
                required
              />
              <p className="text-xs text-muted-foreground">
                This reason is stored on the request and sent to the employee.
              </p>
            </div>
            {decisionError && (
              <p className="text-sm text-destructive-text">{decisionError}</p>
            )}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="mt-2 sm:mt-0"
              onClick={() => {
                setShowRejectDialog(false);
                setRejectionReason('');
                setDecisionError('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleReject}
              disabled={rejectLeave.isPending || !rejectionReason.trim()}
              variant="destructive"
            >
              {rejectLeave.isPending ? 'Rejecting...' : 'Reject Leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
