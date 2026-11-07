'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { TeamMember } from '@/hooks/use-team';
import { restClient } from '@/lib/api/rest-client';
import { plural } from '@/lib/plural';
import { AlertTriangle } from 'lucide-react';

interface DeleteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember | null;
  onConfirm: () => void;
  isDeleting?: boolean;
  /** Switch their access off instead — kept, reversible, and nothing is tidied away. */
  onDeactivate?: () => void;
}

export function DeleteMemberDialog({
  open,
  onOpenChange,
  member,
  onConfirm,
  isDeleting = false,
  onDeactivate,
}: DeleteMemberDialogProps) {
  // What they leave behind, asked when the dialog opens.
  const { data: footprint } = useQuery({
    queryKey: ['member-footprint', member?.id],
    enabled: open && Boolean(member?.id),
    queryFn: async () =>
      (await restClient.get(`/api/v1/workspace_members/${member!.id}/footprint/`)) as {
        openTasks: number;
        pendingLeave: number;
        pendingTime: number;
      },
  });
  if (!member) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-destructive-text">
            <AlertTriangle className="h-5 w-5" />
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
          </div>
          {/* asChild: Radix renders the description as a <p>, and two block
              paragraphs cannot legally nest inside one. */}
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Are you sure you want to remove{' '}
                <strong className="text-foreground">{member.name}</strong> ({member.email}) from the
                team?
              </p>
              {footprint &&
                (footprint.openTasks > 0 || footprint.pendingLeave > 0 || footprint.pendingTime > 0) && (
                  <ul className="list-disc space-y-1 pl-5">
                    {footprint.openTasks > 0 && (
                      <li>
                        They come off {plural(footprint.openTasks, 'open task')} still assigned to
                        them.
                      </li>
                    )}
                    {footprint.pendingLeave > 0 && (
                      <li>
                        {plural(footprint.pendingLeave, 'leave request')} waiting on a decision{' '}
                        {footprint.pendingLeave === 1 ? 'is' : 'are'} withdrawn.
                      </li>
                    )}
                    {footprint.pendingTime > 0 && (
                      <li>
                        {plural(footprint.pendingTime, 'time entry', 'time entries')} awaiting
                        approval stay in the queue — the hours were worked.
                      </li>
                    )}
                  </ul>
                )}
              <p className="text-destructive-text font-medium">
                Removing cannot be undone. Switching their access off keeps everything and can be
                reversed.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel disabled={isDeleting} className="mt-2 sm:mt-0">
              Cancel
            </AlertDialogCancel>
            {onDeactivate && member.status === 'ACTIVE' && (
              <Button variant="outline" disabled={isDeleting} onClick={onDeactivate}>
                Switch access off instead
              </Button>
            )}
          </div>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Removing...' : 'Remove Member'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
