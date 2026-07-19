'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDeleteWorkspace } from '@/hooks/use-workspace';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useWorkspaceContext } from '@/components/providers/workspace-provider';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteWorkspaceDialog({ open, onOpenChange }: DeleteWorkspaceDialogProps) {
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();
  const { clearWorkspaceData } = useWorkspaceContext();
  const { mutate: deleteWorkspace, isPending } = useDeleteWorkspace();
  const [confirmText, setConfirmText] = useState('');

  const handleDelete = () => {
    if (!currentWorkspace) return;
    if (confirmText !== 'DELETE') return;

    deleteWorkspace(currentWorkspace.id, {
      onSuccess: () => {
        clearWorkspaceData();
        onOpenChange(false);
        setConfirmText('');
        router.push('/workspaces');
      },
    });
  };

  if (!currentWorkspace) return null;

  const isConfirmed = confirmText === 'DELETE';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Delete Workspace
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the workspace and all
            associated data including projects, tasks, epics, sprints, requirements, and team data.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <Alert variant="destructive">
            <AlertDescription>
              You are about to delete:{' '}
              <strong className="font-semibold">{currentWorkspace.name}</strong>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="confirm">
              Type <strong className="font-mono">DELETE</strong> to confirm
            </Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="font-mono"
            />
          </div>
        </div>

        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-between sm:space-x-0">
          <AlertDialogCancel
            disabled={isPending}
            onClick={() => setConfirmText('')}
            className="mt-2 sm:mt-0"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            disabled={!isConfirmed || isPending}
          >
            {isPending ? 'Deleting...' : 'Delete Workspace'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
