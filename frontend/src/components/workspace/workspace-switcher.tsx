'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/components/providers/auth-provider';
import { useCreateWorkspace } from '@/hooks/use-workspace';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useIsAdmin } from '@/hooks/use-permissions';

interface WorkspaceSwitcherProps {
  className?: string;
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { user } = useAuth();
  const { currentWorkspace, currentWorkspaceId, workspaces, isLoading, setCurrentWorkspaceId } = useCurrentWorkspace();
  const createWorkspace = useCreateWorkspace();
  const isAdmin = useIsAdmin();

  const [open, setOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) return;

    await createWorkspace.mutateAsync({
      name,
      description,
      ownerId: user.id,
    });

    setName('');
    setDescription('');
    setDialogOpen(false);
  };

  if (isLoading) {
    return (
      <Button variant="outline" className={cn('w-full justify-between', className)} disabled>
        Loading...
      </Button>
    );
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select a workspace"
            className={cn('w-full justify-between', className)}
          >
            {currentWorkspace ? currentWorkspace.name : 'Select workspace'}
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[200px]">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces?.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => {
                if (workspace.id !== currentWorkspaceId) {
                  setCurrentWorkspaceId(workspace.id);
                }
                setOpen(false);
              }}
              className="cursor-pointer"
            >
              <Check
                className={cn(
                  'mr-2 h-4 w-4',
                  currentWorkspaceId === workspace.id ? 'opacity-100' : 'opacity-0'
                )}
              />
              {workspace.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {isAdmin && (
            <DropdownMenuItem
              onSelect={() => {
                setOpen(false);
                setDialogOpen(true);
              }}
              className="cursor-pointer"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Workspace
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
              <Label htmlFor="name">Workspace Name</Label>
              <Input
                id="name"
                placeholder="My Workspace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="What's this workspace for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createWorkspace.isPending}>
              {createWorkspace.isPending ? 'Creating...' : 'Create Workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
