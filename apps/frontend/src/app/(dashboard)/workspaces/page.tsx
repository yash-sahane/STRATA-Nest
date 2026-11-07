'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useLeaveWorkspace, useWorkspaces } from '@/hooks/use-workspace';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NewWorkspaceButton } from '@/components/workspace/create-workspace-dialog';
import { JoinWorkspaceDialog } from '@/components/workspace/join-workspace-dialog';
import { DeleteWorkspaceDialog } from '@/components/workspace/delete-workspace-dialog';
import { LogOut, MoreVertical, Settings, Trash2, Users, Calendar } from 'lucide-react';
import { useConfirm } from '@/components/providers/confirm-provider';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useHasPermissionIn, useWorkspaceRole } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import type { Workspace } from '@/types';

/**
 * Invite affordance for ONE card. Resolved per workspace, because the card grid
 * spans workspaces the caller holds different roles in.
 *
 * Ownership is not the rule the server applies:
 * `WorkspaceAccessService.assertPermission` has no owner special-case — it
 * grants on platform-admin or on the ACTIVE membership's role holding
 * `member:invite`. Gating on `ownerId` therefore hid the button from a MANAGER
 * of a workspace they do not own (whom the API authorizes) and offered it to an
 * owner sitting on a MEMBER role (whom the API 403s).
 */
function WorkspaceInviteAction({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: () => void;
}) {
  const { allowed } = useHasPermissionIn(workspace.id, Permission.INVITE_MEMBER);
  if (!allowed) return null;
  // People are added in one place — the workspace's Team page — and this
  // takes you there, in that workspace. A dialog here did the same job with
  // different features (no CSV) and different words.
  return (
    <Button variant="outline" onClick={onOpen}>
      Add members
    </Button>
  );
}

/**
 * The card's overflow menu, resolved per workspace for the same reason as the
 * invite action above.
 *
 * "Settings" was offered to every member and led to an Access Denied card for
 * most of them. "Delete" was offered to the OWNER, while the API asks for
 * `workspace:delete` and Settings > Danger Zone asked for the MANAGER role — so
 * a manager who did not create the workspace could delete it from one screen
 * and not the other. Both now ask the question the server asks, and a member
 * who can do neither gets no menu rather than an empty one.
 */
function WorkspaceCardMenu({
  workspace,
  canLeave,
  onOpenSettings,
  onLeave,
  onDelete,
}: {
  workspace: Workspace;
  /** False for the owner: a workspace you own is deleted, not left. */
  canLeave: boolean;
  onOpenSettings: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const { allowed: canManage } = useHasPermissionIn(
    workspace.id,
    Permission.MANAGE_WORKSPACE_SETTINGS
  );
  const { allowed: holdsDelete } = useHasPermissionIn(workspace.id, Permission.DELETE_WORKSPACE);
  const { user } = useAuth();
  // Owner (or platform admin) only — the rule the server applies.
  const canDelete = holdsDelete && (user?.isAdmin === true || workspace.ownerId === user?.id);
  // A platform admin sees every workspace and belongs to few of them: with no
  // membership there is nothing to leave, and the API answers 404.
  const { role: membershipRole } = useWorkspaceRole(workspace.id);
  const mayLeave = canLeave && membershipRole !== null;
  if (!canManage && !canDelete && !mayLeave) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${workspace.name}`}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManage && (
          <DropdownMenuItem onClick={onOpenSettings} className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        )}
        {canManage && (mayLeave || canDelete) && <DropdownMenuSeparator />}
        {/* Every member's own to do — there used to be no way out of a
            workspace short of asking a manager to remove you. */}
        {mayLeave && (
          <DropdownMenuItem onClick={onLeave} className="cursor-pointer">
            <LogOut className="mr-2 h-4 w-4" />
            Leave Workspace
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            onClick={onDelete}
            className="cursor-pointer text-destructive-text focus:text-destructive-text"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function WorkspacesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: workspaces, isLoading, isError, refetch } = useWorkspaces(user?.id);
  const { currentWorkspaceId, setCurrentWorkspaceId } = useCurrentWorkspace();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = React.useState<Workspace | null>(null);
  const leaveWorkspace = useLeaveWorkspace();
  const confirm = useConfirm();

  const handleLeave = async (workspace: Workspace) => {
    const proceed = await confirm({
      title: `Leave ${workspace.name}?`,
      description:
        'You will lose access to its projects, tasks and team straight away. Your past work stays where it is. To come back, somebody has to add you again or you can ask to join.',
      confirmText: 'Leave Workspace',
      destructive: true,
    });
    if (!proceed) return;
    leaveWorkspace.mutate({ workspaceId: workspace.id, workspaceName: workspace.name });
  };

  const openWorkspace = (workspace: Workspace, destination: string) => {
    if (workspace.id !== currentWorkspaceId) {
      setCurrentWorkspaceId(workspace.id);
    }
    router.push(destination);
  };

  if (isLoading) {
    return <PageLoader message="Loading workspaces..." />;
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Workspaces" description="We couldn't load your workspaces." />
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspaces"
        description="Manage your workspaces and team members"
        actions={
          <>
            <JoinWorkspaceDialog />
            {/* A copy of the sidebar's workspace switcher sat here, only so that
                a platform admin could reach the "New Workspace" entry inside
                it. Switching is the sidebar's (and every card's Open); creating
                gets a plain button, shown to the only people who may. */}
            <NewWorkspaceButton />
          </>
        }
      />

      {workspaces && workspaces.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            // The one you are in is marked: five identical cards gave no hint
            // which workspace every other page was showing.
            <Card
              key={workspace.id}
              className={cn(workspace.id === currentWorkspaceId && 'border-primary/40 ring-1 ring-primary/20')}
              aria-current={workspace.id === currentWorkspaceId ? 'true' : undefined}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {workspace.name}
                      {workspace.id === currentWorkspaceId && (
                        <Badge variant="secondary" className="text-xs">
                          Current
                        </Badge>
                      )}
                      {workspace.ownerId === user?.id && (
                        <Badge variant="outline" className="text-xs">
                          Owner
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1.5">
                      {workspace.description || 'No description'}
                    </CardDescription>
                  </div>
                  <WorkspaceCardMenu
                    workspace={workspace}
                    canLeave={workspace.ownerId !== user?.id}
                    onOpenSettings={() => openWorkspace(workspace, '/settings?tab=workspace')}
                    onLeave={() => handleLeave(workspace)}
                    onDelete={() => {
                      setWorkspaceToDelete(workspace);
                      setDeleteDialogOpen(true);
                    }}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>
                      {workspace.memberIds.length}{' '}
                      {workspace.memberIds.length === 1 ? 'member' : 'members'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Created {format(new Date(workspace.createdAt), 'MMM d, yyyy')}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <WorkspaceInviteAction
                    workspace={workspace}
                    onOpen={() => openWorkspace(workspace, '/team?tab=add-members')}
                  />
                  <Button
                    variant="outline"
                    onClick={() => openWorkspace(workspace, '/dashboard')}
                    className="flex-1"
                  >
                    Open Workspace
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Workspaces Yet</CardTitle>
            <CardDescription>
              {user?.isAdmin === true
                ? 'Create your first workspace to start organizing your projects and team.'
                : 'Join one with an invite code from one of its managers.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user?.isAdmin === true ? <NewWorkspaceButton /> : <JoinWorkspaceDialog />}
          </CardContent>
        </Card>
      )}

      {/* One always-mounted instance is fine: the dialog now clears its own
          type-to-confirm state on close and on every change of target. */}
      <DeleteWorkspaceDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setWorkspaceToDelete(null);
        }}
        workspace={workspaceToDelete ?? undefined}
      />
    </div>
  );
}
