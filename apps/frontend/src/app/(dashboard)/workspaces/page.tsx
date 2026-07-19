'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/ui/error-state';
import { PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces, useDeleteWorkspace } from '@/hooks/use-workspace';
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
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';
import { InviteMemberDialog } from '@/components/workspace/invite-member-dialog';
import { MoreVertical, Settings, Trash2, Users, FolderKanban, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';

export default function WorkspacesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: workspaces, isLoading, isError, refetch } = useWorkspaces(user?.id);
  const deleteWorkspace = useDeleteWorkspace();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = React.useState<string | null>(null);

  const handleDelete = async () => {
    if (!workspaceToDelete) return;
    
    await deleteWorkspace.mutateAsync(workspaceToDelete);
    setDeleteDialogOpen(false);
    setWorkspaceToDelete(null);
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
            <Card key={workspace.id} className="hover:shadow-lg transition-shadow">
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
                        onClick={() => router.push(`/workspaces/${workspace.id}/settings`)}
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
                              setWorkspaceToDelete(workspace.id);
                              setDeleteDialogOpen(true);
                            }}
                            className="cursor-pointer text-destructive focus:text-destructive"
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
                    <span>Team workspace</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <FolderKanban className="h-4 w-4" />
                    <span>0 projects</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Created {format(new Date(workspace.createdAt), 'MMM d, yyyy')}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <InviteMemberDialog workspaceId={workspace.id} />
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/workspaces/${workspace.id}`)}
                    className="flex-1"
                  >
                    View Details
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workspace and all associated projects, tasks, and
              data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteWorkspace.isPending ? 'Deleting...' : 'Delete Workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
