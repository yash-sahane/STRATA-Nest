'use client';

import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useSprints, useCreateSprint, useStartSprint, useCompleteSprint, useUpdateSprint, useDeleteSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RowActivator } from '@/components/ui/row-activator';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Calendar, Target, PlayCircle, CheckCircle2, Users, Pencil, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { CreateSprintDialog } from '@/components/sprints/create-sprint-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader, InlineLoader } from '@/components/ui/page-loader';
import { useRouter } from 'next/navigation';
import { useCreateActionParam } from '@/hooks/use-create-action-param';

export default function SprintsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // The command palette's "Create New Sprint" navigates here with ?action=create.
  useCreateActionParam(() => setCreateDialogOpen(true), !!selectedProjectId);
  const [editingSprint, setEditingSprint] = React.useState<any>(null);

  const canCreateSprint = useHasPermission(Permission.CREATE_SPRINT);
  const canEditSprint = useHasPermission(Permission.EDIT_SPRINT);
  const canDeleteSprint = useHasPermission(Permission.DELETE_SPRINT);

  const { data: projects, isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const {
    data: sprints,
    isLoading: sprintsLoading,
    isError: sprintsError,
    refetch: refetchSprints,
  } = useSprints(selectedProjectId);
  const { data: tasks } = useTasks(selectedProjectId);

  const createSprint = useCreateSprint();
  const updateSprint = useUpdateSprint();
  const deleteSprint = useDeleteSprint();
  const confirm = useConfirm();
  const startSprint = useStartSprint();
  const completeSprint = useCompleteSprint();

  // Restore project selection from localStorage or set first project as default
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';
    const savedProjectId = localStorage.getItem(STORAGE_KEY);

    if (savedProjectId && projects?.some(p => p.id === savedProjectId)) {
      // Restore saved project if it still exists
      setSelectedProjectId(savedProjectId);
    } else if (projects && projects.length > 0 && !selectedProjectId) {
      // Default to first project if no saved selection
      const firstProjectId = projects[0].id;
      setSelectedProjectId(firstProjectId);
      localStorage.setItem(STORAGE_KEY, firstProjectId);
    }
  }, [projects, selectedProjectId]);

  // Save project selection to localStorage when changed
  const handleProjectChange = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
  }, []);

  // Sprint dates are date-only wire values ("2026-08-11"). `new Date(...)` would
  // read them as UTC midnight and render the previous day west of UTC; parseISO
  // keeps them on the local calendar day.
  const formatSprintDate = (value: string) => format(parseISO(value), 'MMM d, yyyy');

  const getSprintStats = (sprintId: string) => {
    const sprintTasks = tasks?.filter((t) => t.sprintId === sprintId) || [];
    const totalTasks = sprintTasks.length;
    const completedTasks = sprintTasks.filter((t) => t.status === 'DONE').length;

    const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return {
      totalTasks,
      completedTasks,
      progress,
    };
  };

  const handleCreateSprint = async (data: {
    name: string;
    goal?: string;
    startDate: string;
    endDate: string;
  }) => {
    if (!currentWorkspace || !selectedProjectId || !user) return;

    await createSprint.mutateAsync({
      workspaceId: currentWorkspace.id,
      projectId: selectedProjectId,
      name: data.name,
      goal: data.goal,
      startDate: data.startDate,
      endDate: data.endDate,
      createdBy: user.id,
    });
    setCreateDialogOpen(false);
  };

  const handleUpdateSprint = async (data: {
    name: string;
    goal?: string;
    startDate: string;
    endDate: string;
  }) => {
    if (!editingSprint) return;

    await updateSprint.mutateAsync({
      sprintId: editingSprint.id,
      updates: {
        name: data.name,
        goal: data.goal,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });

    setEditingSprint(null);
  };

  const handleDeleteSprint = async (sprintId: string) => {
    const confirmed = await confirm({
      title: 'Delete sprint?',
      description:
        'This permanently deletes the sprint. Its tasks are not deleted; they are moved out of the sprint. This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    // These three run from a bare onClick, so a rejected mutateAsync would be an
    // unhandled rejection (the hooks already toast the failure).
    try {
      await deleteSprint.mutateAsync({
        sprintId,
        projectId: selectedProjectId,
      });
    } catch {
      /* handled by the mutation's onError toast */
    }
  };

  const handleStartSprint = async (sprintId: string) => {
    try {
      await startSprint.mutateAsync({ sprintId, projectId: selectedProjectId });
    } catch {
      /* handled by the mutation's onError toast */
    }
  };

  const handleCompleteSprint = async (sprintId: string) => {
    const stats = getSprintStats(sprintId);
    // Without these the SPRINT_COMPLETED notification block is never entered,
    // so nobody is told the sprint closed.
    const teamMemberIds = Array.from(
      new Set(
        (tasks ?? [])
          .filter((t) => t.sprintId === sprintId)
          .flatMap((t) => t.assignedTo ?? [])
          .filter(Boolean)
      )
    );

    try {
      await completeSprint.mutateAsync({
        sprintId,
        projectId: selectedProjectId,
        teamMemberIds,
        completedTasks: stats.completedTasks,
        totalTasks: stats.totalTasks,
      });
    } catch {
      /* handled by the mutation's onError toast */
    }
  };

  // Stable reference: an inline literal here re-fires the dialog's reset effect
  // on every render of this page, wiping edits in progress.
  const editingSprintInitialData = React.useMemo(
    () =>
      editingSprint
        ? {
            name: editingSprint.name,
            goal: editingSprint.goal,
            startDate: parseISO(editingSprint.startDate),
            endDate: parseISO(editingSprint.endDate),
          }
        : undefined,
    [editingSprint]
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      // 600/700 rather than 500: these carry white text, and the 500 shades sit
      // at 3.1-3.8:1 against it -- under the 4.5:1 floor for badge-sized text.
      case 'PLANNING':
        return 'bg-gray-600';
      case 'ACTIVE':
        return 'bg-green-700';
      case 'COMPLETED':
        return 'bg-blue-600';
      default:
        return 'bg-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PLANNING':
        return Calendar;
      case 'ACTIVE':
        return PlayCircle;
      case 'COMPLETED':
        return CheckCircle2;
      default:
        return Calendar;
    }
  };

  // Show loading state while data is being fetched
  if (workspacesLoading || projectsLoading || !user) {
    return <PageLoader message="Loading sprints..." />;
  }

  // Show message if no workspace
  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <p className="text-muted-foreground mb-4">No workspace found</p>
        <p className="text-sm text-muted-foreground">Please create or join a workspace first</p>
      </div>
    );
  }

  // Show message if no projects
  if (!projects || projects.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Sprints" description="Plan and manage your agile sprints" />
        <EmptyState
          icon={Calendar}
          title="No projects yet"
          description="Create a project first to start planning sprints."
          action={{ label: 'Go to Projects', onClick: () => router.push('/projects') }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Calendar}
        title="Sprints"
        description="Plan and manage your agile sprints"
        actions={
          <>
            <Select value={selectedProjectId} onValueChange={handleProjectChange}>
              <SelectTrigger aria-label="Select a project" className="w-[200px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects?.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canCreateSprint && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Sprint
              </Button>
            )}
          </>
        }
      />

      {/* Sprint Cards */}
      {sprintsLoading ? (
        <InlineLoader />
      ) : sprintsError ? (
        <ErrorState onRetry={() => refetchSprints()} />
      ) : sprints && sprints.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sprints.map((sprint) => {
            const stats = getSprintStats(sprint.id);
            const StatusIcon = getStatusIcon(sprint.status);

            return (
              <Card
                key={sprint.id}
                className="hover-lift cursor-pointer"
                onClick={() => router.push(`/sprints/${sprint.id}/board`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      {/* The card's onClick is mouse-only. This is the keyboard
                          path to the same board, and a sibling of the card's own
                          action buttons rather than their ancestor. */}
                      <CardTitle className="text-lg">
                        <RowActivator
                          label={`Open sprint board: ${sprint.name}`}
                          onActivate={() => router.push(`/sprints/${sprint.id}/board`)}
                        >
                          {sprint.name}
                        </RowActivator>
                      </CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatSprintDate(sprint.startDate)} - {formatSprintDate(sprint.endDate)}
                      </CardDescription>
                    </div>
                    <Badge className={`${getStatusColor(sprint.status)} text-white`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {sprint.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Goal */}
                  {sprint.goal && (
                    <div className="flex items-start gap-2 text-sm">
                      <Target className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                      <p className="text-muted-foreground line-clamp-2">{sprint.goal}</p>
                    </div>
                  )}

                  {/* Progress */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{Math.round(stats.progress)}%</span>
                    </div>
                    <Progress value={stats.progress} />
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-1 gap-4 pt-2 border-t">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        Tasks Completed
                      </div>
                      <p className="text-lg font-semibold">
                        {stats.completedTasks}/{stats.totalTasks}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 flex-wrap">
                    {canEditSprint && sprint.status === 'PLANNING' && (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartSprint(sprint.id);
                        }}
                      >
                        <PlayCircle className="h-4 w-4 mr-1" />
                        Start Sprint
                      </Button>
                    )}
                    {canEditSprint && sprint.status === 'ACTIVE' && (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompleteSprint(sprint.id);
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Complete Sprint
                      </Button>
                    )}
                    {/* Edit/Delete are NOT status-gated on the server, so don't
                        gate them here — an ACTIVE or COMPLETED sprint created by
                        mistake was otherwise uneditable and undeletable. */}
                    {canEditSprint && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Edit sprint"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSprint(sprint);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDeleteSprint && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label="Delete sprint"
                            className="text-destructive-text hover:text-destructive-text"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSprint(sprint.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete sprint</TooltipContent>
                      </Tooltip>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/sprints/${sprint.id}/backlog`);
                      }}
                    >
                      Backlog
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/sprints/${sprint.id}/analytics`);
                      }}
                    >
                      Analytics
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Calendar}
          title="No sprints yet"
          description={
            canCreateSprint
              ? 'Get started by creating your first sprint.'
              : 'No sprints have been planned for this project yet.'
          }
          action={
            canCreateSprint
              ? { label: 'Create Sprint', onClick: () => setCreateDialogOpen(true) }
              : undefined
          }
        />
      )}

      <CreateSprintDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateSprint}
        isLoading={createSprint.isPending}
      />

      {editingSprint && (
        <CreateSprintDialog
          key={editingSprint.id}
          open={!!editingSprint}
          onOpenChange={(open) => !open && setEditingSprint(null)}
          onSubmit={handleUpdateSprint}
          isLoading={updateSprint.isPending}
          initialData={editingSprintInitialData}
        />
      )}
    </div>
  );
}
