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
import { useApproveLeave, useRejectLeave, type LeaveRequest } from '@/hooks/use-leave';
import {
  LEAVE_TYPES,
  LEAVE_STATUS,
  getLeaveTypeColor,
  getLeaveStatusColor,
  formatLeaveDateRange,
} from '@/lib/leave-utils';

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
  const [showApproveDialog, setShowApproveDialog] = React.useState(false);
  const [showRejectDialog, setShowRejectDialog] = React.useState(false);
  const [approverComments, setApproverComments] = React.useState('');
  const [rejectionReason, setRejectionReason] = React.useState('');

  const approveLeave = useApproveLeave();
  const rejectLeave = useRejectLeave();

  const handleApprove = async () => {
    await approveLeave.mutateAsync({
      leaveRequestId: leaveRequest.id,
      approverId,
      approverName,
      approverComments: approverComments || undefined,
    });
    setShowApproveDialog(false);
    setApproverComments('');
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      return;
    }

    await rejectLeave.mutateAsync({
      leaveRequestId: leaveRequest.id,
      approverId,
      approverName,
      rejectionReason,
    });
    setShowRejectDialog(false);
    setRejectionReason('');
  };

  const isPending = leaveRequest.status === 'PENDING';
  const isApproved = leaveRequest.status === 'APPROVED';
  const isRejected = leaveRequest.status === 'REJECTED';

  return (
    <>
      <Card className="hover:shadow-md transition-shadow">
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
              <Badge className={getLeaveStatusColor(leaveRequest.status)} variant="outline">
                {LEAVE_STATUS[leaveRequest.status]}
              </Badge>
              <Badge className={getLeaveTypeColor(leaveRequest.leaveType)} variant="outline">
                {LEAVE_TYPES[leaveRequest.leaveType]}
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
                {leaveRequest.days} {leaveRequest.days === 1 ? 'day' : 'days'}
                {leaveRequest.halfDay && ' (Half Day)'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Requested:</span>
              <span className="font-medium">
                {new Date(leaveRequest.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Reason:</Label>
            <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
              {leaveRequest.reason}
            </p>
          </div>

          {leaveRequest.emergencyContact && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Emergency Contact:</Label>
              <p className="text-sm text-muted-foreground">{leaveRequest.emergencyContact}</p>
            </div>
          )}

          {leaveRequest.approverComments && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Manager Comments:</Label>
              <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
                {leaveRequest.approverComments}
              </p>
              {leaveRequest.approverName && (
                <p className="text-xs text-muted-foreground">— {leaveRequest.approverName}</p>
              )}
            </div>
          )}
        </CardContent>
        {isPending && (
          <CardFooter className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setShowRejectDialog(true)}
            >
              <X className="mr-2 h-4 w-4" />
              Reject
            </Button>
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={() => setShowApproveDialog(true)}
            >
              <Check className="mr-2 h-4 w-4" />
              Approve
            </Button>
          </CardFooter>
        )}
        {(isApproved || isRejected) && (
          <CardFooter>
            <div className="text-xs text-muted-foreground w-full text-center">
              {isApproved ? 'Approved' : 'Rejected'} by {leaveRequest.approverName} on{' '}
              {leaveRequest.approvedAt && new Date(leaveRequest.approvedAt).toLocaleDateString()}
            </div>
          </CardFooter>
        )}
      </Card>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Leave Request</DialogTitle>
            <DialogDescription>
              You are about to approve {leaveRequest.userName}'s leave request for{' '}
              {leaveRequest.days} {leaveRequest.days === 1 ? 'day' : 'days'}. The employee will be
              notified via email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="approverComments">Comments (Optional)</Label>
              <Textarea
                id="approverComments"
                placeholder="Add any comments or instructions..."
                value={approverComments}
                onChange={(e) => setApproverComments(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowApproveDialog(false);
                setApproverComments('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={approveLeave.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {approveLeave.isPending ? 'Approving...' : 'Approve Leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Leave Request</DialogTitle>
            <DialogDescription>
              You are about to reject {leaveRequest.userName}'s leave request. Please provide a
              reason for rejection. The employee will be notified via email.
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
                This reason will be sent to the employee via email.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              className="mt-2 sm:mt-0"
              onClick={() => {
                setShowRejectDialog(false);
                setRejectionReason('');
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
