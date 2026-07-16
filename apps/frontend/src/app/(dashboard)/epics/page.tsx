'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useEpics } from '@/hooks/use-epic';
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
import { Plus, Target, CheckCircle2, Clock, TrendingUp, Calendar } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { Epic } from '@/types';
import { CreateEpicDialog } from '@/components/epic/create-epic-dialog';
import { EpicDetailDialog } from '@/components/epic/epic-detail-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useIsAdmin, useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

const statusConfig: Record<
  Epic['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  TODO: { label: 'To Do', variant: 'secondary' },
  IN_PROGRESS: { label: 'In Progress', variant: 'default' },
  DONE: { label: 'Done', variant: 'default' },
};

export default function EpicsPage() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(currentWorkspace?.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams.get('projectId');
  const epicIdFromUrl = searchParams.get('epicId');

  // Permission checks
  const isAdmin = useIsAdmin();
  const canCreateEpic = useHasPermission(Permission.CREATE_EPIC);
  const canDeleteEpic = useHasPermission(Permission.DELETE_EPIC);

  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [selectedEpic, setSelectedEpic] = React.useState<Epic | null>(null);

  const { data: epics = [], isLoading } = useEpics(selectedProjectId);
  const { data: tasks = [] } = useTasks(selectedProjectId);

  // Restore project selection from URL or localStorage
  React.useEffect(() => {
    const STORAGE_KEY = 'selected-project-id';

    // Priority: URL param > localStorage > first project
    if (projectIdFromUrl && projects.some((p) => p.id === projectIdFromUrl)) {
      setSelectedProjectId(projectIdFromUrl);
      localStorage.setItem(STORAGE_KEY, projectIdFromUrl);
    } else {
      const savedProjectId = localStorage.getItem(STORAGE_KEY);
      if (savedProjectId && projects.some((p) => p.id === savedProjectId)) {
        // Restore saved project if it still exists
        setSelectedProjectId(savedProjectId);
      } else if (projects.length > 0 && !selectedProjectId) {
        // Default to first project if no saved selection
        const firstProjectId = projects[0].id;
        setSelectedProjectId(firstProjectId);
        localStorage.setItem(STORAGE_KEY, firstProjectId);
      }
    }
  }, [projects, selectedProjectId, projectIdFromUrl]);

  // Open epic dialog if epicId is in URL (from notification click)
  React.useEffect(() => {
    if (epicIdFromUrl && epics.length > 0) {
      const epic = epics.find((e) => e.id === epicIdFromUrl);
      if (epic) {
        setSelectedEpic(epic);
        // Clear the epicId from URL after opening the dialog
        const params = new URLSearchParams(searchParams.toString());
        params.delete('epicId');
        const newUrl = params.toString() ? `/epics?${params.toString()}` : '/epics';
        router.replace(newUrl);
      }
    }
  }, [epicIdFromUrl, epics, searchParams, router]);

  // Save project selection to localStorage when changed
  const handleProjectChange = React.useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('selected-project-id', projectId);
  }, []);

  // Calculate stats
  const stats = React.useMemo(() => {
    return {
      total: epics.length,
      todo: epics.filter((e) => e.status === 'TODO').length,
      inProgress: epics.filter((e) => e.status === 'IN_PROGRESS').length,
      done: epics.filter((e) => e.status === 'DONE').length,
    };
  }, [epics]);

  // Calculate epic metrics
  const getEpicMetrics = (epic: Epic) => {
    // Calculate task metrics for display
    const epicTasks = tasks.filter((t) => t.epicId === epic.id);
    const completedTasks = epicTasks.filter((t) => t.status === 'DONE').length;

    // Use stored progress from database if available (updated when tasks change)
    // Otherwise calculate from tasks directly
    let progress = epic.progress ?? 0;

    // If no stored progress, calculate it
    if (progress === 0 && epicTasks.length > 0) {
      progress = Math.round((completedTasks / epicTasks.length) * 100);
    }

    return {
      totalTasks: epicTasks.length,
      completedTasks,
      progress,
    };
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Target}
        title="Epics"
        description="Large features spanning multiple sprints"
        actions={
          (canCreateEpic || isAdmin) && (
            <Button onClick={() => setCreateDialogOpen(true)} disabled={!selectedProjectId}>
              <Plus className="mr-2 h-4 w-4" />
              New Epic
            </Button>
          )
        }
      />

      {/* Project Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Project</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedProjectId} onValueChange={handleProjectChange}>
            <SelectTrigger className="w-full md:w-[400px]">
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.shortCode} - {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedProjectId && (
        <>
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Epics</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">To Do</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.todo}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.inProgress}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.done}</div>
              </CardContent>
            </Card>
          </div>

          {/* Epics Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {isLoading ? (
              <div className="col-span-full text-center py-8 text-muted-foreground">
                Loading epics...
              </div>
            ) : epics.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <Target className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                <p className="text-muted-foreground mb-4">No epics yet</p>
                {(canCreateEpic || isAdmin) && (
                  <Button onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create First Epic
                  </Button>
                )}
              </div>
            ) : (
              epics.map((epic) => {
                const metrics = getEpicMetrics(epic);
                const status = statusConfig[epic.status];

                return (
                  <Card
                    key={epic.id}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => setSelectedEpic(epic)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className="font-mono">
                          {epic.hierarchyId}
                        </Badge>
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: epic.color }}
                        />
                      </div>
                      <CardTitle className="text-lg">{epic.name}</CardTitle>
                      {epic.description && (
                        <CardDescription className="line-clamp-2">
                          {epic.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Status */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>

                      {/* Progress */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Progress</span>
                          <span className="font-medium">{metrics.progress}%</span>
                        </div>
                        <Progress value={metrics.progress} />
                      </div>

                      {/* Tasks */}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tasks</span>
                        <span className="font-medium">
                          {metrics.completedTasks} / {metrics.totalTasks}
                        </span>
                      </div>

                      {/* Dates */}
                      {(epic.startDate || epic.endDate) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {epic.startDate && <span>{formatDate(epic.startDate)}</span>}
                          {epic.startDate && epic.endDate && <span>→</span>}
                          {epic.endDate && <span>{formatDate(epic.endDate)}</span>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Create Dialog */}
      <CreateEpicDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        projectId={selectedProjectId}
        projectCode={selectedProject?.shortCode || ''}
        workspaceId={currentWorkspace?.id || ''}
        userId={user?.id || ''}
      />

      {/* Detail Dialog */}
      {selectedEpic && (
        <EpicDetailDialog
          epic={selectedEpic}
          open={!!selectedEpic}
          onOpenChange={(open: boolean) => !open && setSelectedEpic(null)}
          projectId={selectedProjectId}
          tasks={tasks.filter((t) => t.epicId === selectedEpic.id)}
          canDelete={canDeleteEpic || isAdmin}
        />
      )}
    </div>
  );
}
