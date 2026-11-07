'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { CreateWorkspaceDialog } from '@/components/workspace/create-workspace-dialog';

interface WorkspaceSwitcherProps {
  className?: string;
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { user } = useAuth();
  const { currentWorkspace, currentWorkspaceId, workspaces, isLoading, setCurrentWorkspaceId } = useCurrentWorkspace();
  // Creating a workspace is a PLATFORM-admin action (the API enforces it), not
  // a workspace-role one — useIsAdmin() reads the current workspace's role and
  // offered the entry point to managers the server would reject.
  const canCreateWorkspace = user?.isAdmin === true;

  const [open, setOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (isLoading) {
    return (
      <Button variant="outline" className={cn('w-full justify-between', className)} disabled>
        Loading...
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select a workspace"
            className={cn('w-full justify-between', className)}
          >
            <span className="truncate">
              {currentWorkspace ? currentWorkspace.name : 'Select workspace'}
            </span>
            <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        {/* The menu grows with the workspace list and the primitive is
            `overflow-hidden` with no cap, so on a long list it ran off the
            bottom of the screen: the last workspaces and "Create Workspace"
            could not be reached by mouse, wheel or keyboard, and Radix's scroll
            lock stopped the page behind it from scrolling either. Radix already
            measures the space it has — cap the height with it and scroll. */}
        <DropdownMenuContent className="w-[200px] max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
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
          {canCreateWorkspace && (
            <DropdownMenuItem
              onSelect={(event) => {
                // Let the menu finish closing before the dialog claims focus,
                // otherwise the two focus scopes fight over the first field.
                event.preventDefault();
                setOpen(false);
                setDialogOpen(true);
              }}
              className="cursor-pointer"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              New Workspace
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The same dialog the Workspaces page's own button opens. */}
      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
