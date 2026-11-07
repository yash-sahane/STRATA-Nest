'use client';

import * as React from 'react';
import { PlusCircle } from 'lucide-react';
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
import { useAuth } from '@/components/providers/auth-provider';
import { useCreateWorkspace } from '@/hooks/use-workspace';
import {
  WorkspaceManagerFields,
  NO_MANAGER_CHOICE,
  managerOf,
  managerChoiceComplete,
  type ManagerChoice,
} from '@/components/workspace/workspace-manager-fields';
import { TempPasswordNotice, type IssuedCredential } from '@/components/team/temp-password-notice';

/**
 * The "Create Workspace" dialog, wherever it is opened from — the switcher's
 * menu and the Workspaces page both open this one, so the two cannot drift.
 *
 * Creating a workspace is a PLATFORM-admin action (the API enforces it); the
 * places that offer it check `user.isAdmin` before showing the way in.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [managerChoice, setManagerChoice] = React.useState<ManagerChoice>(NO_MANAGER_CHOICE);
  const [issued, setIssued] = React.useState<IssuedCredential[]>([]);

  const close = () => {
    setName('');
    setDescription('');
    setManagerChoice(NO_MANAGER_CHOICE);
    setIssued([]);
    onOpenChange(false);
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    try {
      const created = await createWorkspace.mutateAsync({
        name,
        description,
        ownerId: user.id,
        manager: managerOf(managerChoice),
      });
      if (created.manager?.temporaryPassword) {
        // Kept open to show it: this is the only place it will ever appear.
        setIssued([
          {
            name: created.manager.name,
            email: created.manager.email,
            temporaryPassword: created.manager.temporaryPassword,
          },
        ]);
        return;
      }
    } catch {
      // error toast handled inside the mutation; leave the dialog open so the
      // typed name is not lost
      return;
    }

    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>
            Create a new workspace to organize your projects and team.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateWorkspace}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-workspace-name">Workspace Name</Label>
              <Input
                id="new-workspace-name"
                placeholder="My Workspace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-workspace-description">Description (Optional)</Label>
              <Textarea
                id="new-workspace-description"
                placeholder="What's this workspace for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <WorkspaceManagerFields
              value={managerChoice}
              onChange={setManagerChoice}
              idPrefix="new-workspace"
            />
            <TempPasswordNotice credentials={issued} onDismiss={close} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createWorkspace.isPending || issued.length > 0 || !managerChoiceComplete(managerChoice)
              }
            >
              {createWorkspace.isPending ? 'Creating...' : 'Create Workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A plain "New Workspace" button opening the dialog — for platform admins only;
 * renders nothing for anybody else, whom the API would refuse.
 */
export function NewWorkspaceButton({ className }: { className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  if (user?.isAdmin !== true) return null;
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        <PlusCircle className="mr-2 h-4 w-4" />
        New Workspace
      </Button>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
