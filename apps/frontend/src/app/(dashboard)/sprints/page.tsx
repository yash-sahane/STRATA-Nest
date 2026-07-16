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
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Calendar, Target, PlayCircle, CheckCircle2, Users, Pencil, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { CreateSprintDialog } from '@/components/sprints/create-sprint-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/providers/confirm-provider';
import { useRouter } from 'next/navigation';

export default function SprintsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editingSprint, setEditingSprint] = React.useState<any>(null);

  const { data: projects, isLoading: projectsLoading } = useProjects(currentWorkspace?.id);
  const { data: sprints, isLoading: sprintsLoading } = useSprints(selectedProjectId);
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
      description: 'This permanently deletes the sprint. This action cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;

    await deleteSprint.mutateAsync({
      sprintId,
      projectId: selectedProjectId,
    });
  };

  const handleStartSprint = async (sprintId: string) => {
    await startSprint.mutateAsync({ sprintId, projectId: selectedProjectId });
  };

  const handleCompleteSprint = async (sprintId: string) => {
    await completeSprint.mutateAsync({ sprintId, projectId: selectedProjectId });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PLANNING':
        return 'bg-gray-500';
      case 'ACTIVE':
        return 'bg-green-500';
      case 'COMPLETED':
        return 'bg-blue-500';
      default:
        return 'bg-gray-500';
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
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create a project first to start planning sprints
            </p>
            <Button onClick={() => router.push('/projects')}>
              Go to Projects
            </Button>
          </CardContent>
        </Card>
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
              <SelectTrigger className="w-[200px]">
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
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Sprint
            </Button>
          </>
        }
      />

      {/* Sprint Cards */}
      {sprintsLoading ? (
        <div className="flex items-center justify-center h-[50vh]">
          <p className="text-muted-foreground">Loading sprints...</p>
        </div>
      ) : sprints && sprints.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sprints.map((sprint) => {
            const stats = getSprintStats(sprint.id);
            const StatusIcon = getStatusIcon(sprint.status);

            return (
              <Card
                key={sprint.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/sprints/${sprint.id}/board`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{sprint.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
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
                    {sprint.status === 'PLANNING' && (
                      <>
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSprint(sprint);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSprint(sprint.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {sprint.status === 'ACTIVE' && (
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
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sprints yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Get started by creating your first sprint
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Sprint
            </Button>
          </CardContent>
        </Card>
      )}

      <CreateSprintDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateSprint}
        isLoading={createSprint.isPending}
      />

      {editingSprint && (
        <CreateSprintDialog
          open={!!editingSprint}
          onOpenChange={(open) => !open && setEditingSprint(null)}
          onSubmit={handleUpdateSprint}
          isLoading={updateSprint.isPending}
          initialData={{
            name: editingSprint.name,
            goal: editingSprint.goal,
            startDate: new Date(editingSprint.startDate),
            endDate: new Date(editingSprint.endDate),
          }}
        />
      )}
    </div>
  );
}
