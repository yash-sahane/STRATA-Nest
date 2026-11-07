'use client';

import { getSprintStatusConfig } from '@/lib/semantic/status';
import * as React from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useIsProjectArchived, useProjects } from '@/hooks/use-project';
import { ArchivedProjectBanner } from '@/components/projects/archived-project-banner';
import { toast } from 'sonner';
import { useSprints, useCreateSprint, useStartSprint, useCompleteSprint, useUpdateSprint, useDeleteSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RowLink } from '@/components/ui/row-activator';
import { Progress } from '@/components/ui/progress';
import { Plus, Calendar, Target, PlayCircle, CheckCircle2, Users, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { CreateSprintDialog } from '@/components/sprints/create-sprint-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/providers/confirm-provider';
import { sprintFigures, sprintSchedule } from '@/lib/sprint-figures';
import { plural } from '@/lib/plural';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { PageLoader, InlineLoader } from '@/components/ui/page-loader';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCreateActionParam } from '@/hooks/use-create-action-param';
import { basedOnFor, changedFields } from '@/lib/utils/changed-fields';
import type { EditBasedOn, Sprint } from '@/types';
import { ProjectPicker } from '@/components/projects/project-picker';
import { useProjectSelectionSync } from '@/hooks/use-project-selection-sync';
import { useSprintsRealtime, useTasksRealtime } from '@/hooks/use-realtime';

export default function SprintsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  // An archived project is read-only (the server refuses the change), so its
  // sprints are not created, edited, started, completed or deleted from here.
  const projectArchived = useIsProjectArchived(selectedProjectId);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  // The command palette's "New Sprint" navigates here with ?action=create.
  useCreateActionParam(() => {
    if (projectArchived) {
      toast.info('This project is archived.', { description: 'Unarchive it to plan sprints in it.' });
      return;
    }
    setCreateDialogOpen(true);
  }, !!selectedProjectId);
  const [editingSprint, setEditingSprint] = React.useState<Sprint | null>(null);

  const canCreateSprint = useHasPermission(Permission.CREATE_SPRINT) && !projectArchived;
  const canEditSprint = useHasPermission(Permission.EDIT_SPRINT) && !projectArchived;
  const canDeleteSprint = useHasPermission(Permission.DELETE_SPRINT) && !projectArchived;

  const { data: projects, isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const {
    data: sprints,
    isLoading: sprintsLoading,
    isError: sprintsError,
    refetch: refetchSprints,
  } = useSprints(selectedProjectId);
  // Somebody else starting, completing or planning a sprint shows up here
  // without a reload — the list used to be a snapshot of when it was opened.
  useSprintsRealtime(selectedProjectId);
  useTasksRealtime(selectedProjectId);
  const { data: tasks } = useTasks(selectedProjectId);

  const createSprint = useCreateSprint();
  const updateSprint = useUpdateSprint();
  const deleteSprint = useDeleteSprint();
  const confirm = useConfirm();
  const startSprint = useStartSprint();
  const completeSprint = useCompleteSprint();

  // Remembered project, else the first — and never one from another workspace.
  const projectList = React.useMemo(() => projects ?? [], [projects]);
  // ?projectId= from a sprint's own pages ("Sprints"), so the list comes back
  // on the project the sprint belongs to.
  const searchParams = useSearchParams();
  useProjectSelectionSync({
    projects: projectList,
    urlProjectId: searchParams.get('projectId'),
    selectedProjectId,
    setSelectedProjectId,
  });

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
    // The same figures as the sprint's own board and Analytics (sprintFigures).
    const figures = sprintFigures(sprints?.find((s) => s.id === sprintId), sprintTasks);
    return {
      totalTasks: figures.total,
      completedTasks: figures.completed,
      progress: figures.completionRate,
      /** Tasks still in it — what the API checks before deleting a closed sprint. */
      attachedTasks: sprintTasks.length,
    };
  };

  // A project runs one sprint at a time (the API refuses a second), so the Start
  // button on the others says why instead of failing when pressed.
  const activeSprint = sprints?.find((s) => s.status === 'ACTIVE');

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

    // Only what changed — see changedFields. Submitting the whole form wrote back
    // values that were stale from the moment the dialog opened, over concurrent edits
    // to fields nobody here had touched. `basedOn` below covers the remaining case,
    // where both people edited the same field.
    const updates = changedFields(
      editingSprint as unknown as Record<string, unknown>,
      {
        name: data.name,
        goal: data.goal,
        startDate: data.startDate,
        endDate: data.endDate,
      } as Record<string, unknown>,
    );
    if (Object.keys(updates).length > 0) {
      await updateSprint.mutateAsync({
        sprintId: editingSprint.id,
        // What those fields held when this dialog opened. Narrowing the patch cannot
        // cover two people editing the SAME field; this can. If somebody else changed
        // one of them the API refuses the save and names it, this function rethrows,
        // `setEditingSprint(null)` below is skipped, and the dialog stays open holding
        // what was typed.
        updates: {
          ...updates,
          basedOn: basedOnFor(editingSprint as unknown as Record<string, unknown>, updates),
        } as EditBasedOn<Partial<Sprint>>,
      });
    }

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
    const sprint = sprints?.find((s) => s.id === sprintId);
    const unfinished = stats.totalTasks - stats.completedTasks;

    // Closing a sprint cannot be undone, and it moves other people's work: one
    // click used to do both without a word. Say what is about to happen first.
    const confirmed = await confirm({
      title: `Complete ${sprint?.name ?? 'this sprint'}?`,
      description:
        unfinished > 0
          ? `${stats.completedTasks} of ${stats.totalTasks} tasks are done. The ${unfinished} unfinished ${unfinished === 1 ? 'task leaves' : 'tasks leave'} the sprint, with ${unfinished === 1 ? 'its requirement' : 'their requirements'}, to be planned into another one. A completed sprint cannot be reopened.`
          : `All ${stats.totalTasks} tasks are done. A completed sprint cannot be reopened.`,
      confirmText: 'Complete Sprint',
    });
    if (!confirmed) return;
    try {
      await completeSprint.mutateAsync({ sprintId, projectId: selectedProjectId });
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
      <EmptyState
        title="No workspace found"
        description="Create or join a workspace to plan sprints."
      />
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
          action={{ label: 'Go to Projects', href: '/projects' }}
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
            <ProjectPicker
              projects={projects ?? []}
              value={selectedProjectId}
              onChange={handleProjectChange}
              className="w-full sm:w-[240px]"
            />
            {canCreateSprint && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New Sprint
              </Button>
            )}
          </>
        }
      />

      <ArchivedProjectBanner projectId={selectedProjectId} />

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
            // Still running past its last day. The card said only "Active", so a
            // sprint three weeks over read exactly like one on schedule.
            const endedDaysAgo =
              sprint.status === 'ACTIVE' ? sprintSchedule(sprint).endedDaysAgo : 0;

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
                        <RowLink label={`Open sprint board: ${sprint.name}`} href={`/sprints/${sprint.id}/board`}>
                          {sprint.name}
                        </RowLink>
                      </CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatSprintDate(sprint.startDate)} - {formatSprintDate(sprint.endDate)}
                      </CardDescription>
                      {endedDaysAgo > 0 && (
                        <p className="flex items-center gap-1 text-xs font-medium text-warning-text">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                          Overdue — ended {plural(endedDaysAgo, 'day')} ago
                        </p>
                      )}
                    </div>
                    <Badge variant={getSprintStatusConfig(sprint.status).badgeVariant}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {getSprintStatusConfig(sprint.status).label}
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

                  {canEditSprint && sprint.status === 'PLANNING' && activeSprint && (
                    <p className="text-xs text-muted-foreground">
                      Complete &ldquo;{activeSprint.name}&rdquo; before starting this one — a project
                      runs one sprint at a time.
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2 flex-wrap">
                    {canEditSprint && sprint.status === 'PLANNING' && (
                      <Button
                        size="sm"
                        variant="default"
                        className="flex-1"
                        disabled={Boolean(activeSprint)}
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
                    {/* Edit for every sprint — a completed one keeps its goal and
                        dates and renames only, as the API allows. */}
                    {canEditSprint && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Edit ${sprint.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSprint(sprint);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {/* A completed sprint that holds finished work is history,
                        and the API keeps it. */}
                    {canDeleteSprint &&
                      !(sprint.status === 'COMPLETED' && getSprintStats(sprint.id).attachedTasks > 0) && (
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
                      Plan
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
              ? { label: 'New Sprint', onClick: () => setCreateDialogOpen(true) }
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
          recordLocked={editingSprint.status === 'COMPLETED'}
        />
      )}
    </div>
  );
}
