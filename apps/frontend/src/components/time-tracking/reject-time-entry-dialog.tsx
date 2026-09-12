'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatMinutesHuman } from '@/lib/utils/time-format';
import type { TimeEntry } from '@/types';

interface RejectTimeEntryDialogProps {
  entry: TimeEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void | Promise<void>;
  isPending?: boolean;
}

/**
 * Rejection needs a typed reason, the same way a leave rejection does. The
 * plain confirm dialog this replaces sent the literal string "Rejected by
 * approver" for every entry, so the reason the API stores — and the member now
 * reads on their timesheet — told them nothing about what to fix.
 */
export function RejectTimeEntryDialog({
  entry,
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: RejectTimeEntryDialogProps) {
  const [reason, setReason] = React.useState('');

  const handleReject = async () => {
    if (!reason.trim()) return;
    await onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reject this time entry?</DialogTitle>
          <DialogDescription>
            {formatMinutesHuman(entry.duration)} logged by{' '}
            {entry.userName || entry.userEmail || 'this member'}. They will see it as rejected,
            with your reason, and can correct and resubmit it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="time-rejection-reason">Rejection reason *</Label>
          <Textarea
            id="time-rejection-reason"
            placeholder="What is wrong with this entry?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            required
          />
          <p className="text-xs text-muted-foreground">
            This is shown on the member&apos;s own timesheet.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleReject}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? 'Rejecting...' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
