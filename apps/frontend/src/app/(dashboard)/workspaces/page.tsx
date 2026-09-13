'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
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
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';
import { InviteMemberDialog } from '@/components/workspace/invite-member-dialog';
import { DeleteWorkspaceDialog } from '@/components/workspace/delete-workspace-dialog';
import { MoreVertical, Settings, Trash2, Users, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useHasPermissionIn } from '@/hooks/use-permissions';
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
function WorkspaceInviteAction({ workspace }: { workspace: Workspace }) {
  const { allowed } = useHasPermissionIn(workspace.id, Permission.INVITE_MEMBER);
  if (!allowed) return null;
  return <InviteMemberDialog workspaceId={workspace.id} />;
}

export default function WorkspacesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: workspaces, isLoading, isError, refetch } = useWorkspaces(user?.id);
  const { currentWorkspaceId, setCurrentWorkspaceId } = useCurrentWorkspace();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = React.useState<Workspace | null>(null);

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
        actions={<WorkspaceSwitcher />}
      />

      {workspaces && workspaces.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <Card key={workspace.id} className="hover-lift">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {workspace.name}
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => openWorkspace(workspace, '/settings?tab=workspace')}
                        className="cursor-pointer"
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </DropdownMenuItem>
                      {workspace.ownerId === user?.id && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              setWorkspaceToDelete(workspace);
                              setDeleteDialogOpen(true);
                            }}
                            className="cursor-pointer text-destructive-text focus:text-destructive-text"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                  <WorkspaceInviteAction workspace={workspace} />
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
              Create your first workspace to start organizing your projects and team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkspaceSwitcher />
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
