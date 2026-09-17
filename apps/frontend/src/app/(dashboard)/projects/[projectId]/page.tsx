'use client';

import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { getProjectStatusConfig } from '@/lib/semantic/status';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProject } from '@/hooks/use-project';
import { useTasks } from '@/hooks/use-task';
import { useEpics } from '@/hooks/use-epic';
import { useSprints } from '@/hooks/use-sprint';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProjectFilesPanel } from '@/components/files/project-files-panel';
import {
  ArrowLeft,
  Calendar,
  Users,
  GitBranch,
  Kanban,
  Settings,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { formatProjectDate } from '@/components/projects/project-dates';
import { ProjectHealthCard } from '@/components/projects/project-health-card';
import { calculateProjectHealth } from '@/lib/project-health';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  // Fetch by id: resolving through the CURRENT workspace's list reported a
  // perfectly accessible project as missing whenever the selected workspace was
  // a different one (or had not hydrated yet on first paint).
  const { data: project, isLoading, isError, refetch } = useProject(projectId);
  // Keyed off the ROUTE PARAM, not `project?.id`. They are the same value, but
  // waiting for the project response turned the task list into a second round
  // trip that only started once the first had landed — the waterfall that made
  // the health card mount ~150ms after the page had already painted. Both
  // requests now leave together.
  //
  // `isPending`, not `isLoading`: it is true for every render before the task
  // list exists, which is exactly the window the health card's loading state
  // has to cover.
  const { data: tasks = [], isPending: tasksPending } = useTasks(projectId);
  // For "Recent Updates" below, which promises every project entity. Both are
  // already cached elsewhere on this route, so neither is an extra round trip in
  // practice.
  const { data: epics = [] } = useEpics(projectId);
  const { data: sprints = [] } = useSprints(projectId);

  /**
   * The five things in this project that changed most recently.
   *
   * `useTasks` orders by board `position`, so taking `tasks.slice(0, 5)` — which
   * is what this card used to do — listed the leftmost five cards on the board
   * and called them recent. Nothing on the row showed a time, so there was no
   * way to notice.
   */
  const recentUpdates = React.useMemo(() => {
    type Row = {
      id: string;
      kind: 'Task' | 'Epic' | 'Sprint';
      ref?: string;
      title: string;
      description?: string;
      status?: string;
      updatedAt?: string;
    };
    const rows: Row[] = [
      ...tasks.map((t) => ({
        id: t.id,
        kind: 'Task' as const,
        ref: t.hierarchyId,
        title: t.title,
        description: t.description,
        status: t.status,
        updatedAt: t.updatedAt ?? t.createdAt,
      })),
      ...epics.map((e) => ({
        id: e.id,
        kind: 'Epic' as const,
        ref: e.hierarchyId,
        title: e.name,
        description: e.description,
        status: e.status,
        updatedAt: e.updatedAt ?? e.createdAt,
      })),
      ...sprints.map((sp) => ({
        id: sp.id,
        kind: 'Sprint' as const,
        title: sp.name,
        description: sp.goal,
        status: sp.status,
        updatedAt: sp.updatedAt ?? sp.createdAt,
      })),
    ];
    return rows
      .filter((r) => Boolean(r.updatedAt))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 5);
  }, [tasks, epics, sprints]);

  // Calculate task statistics
  const taskStats = React.useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'DONE').length;
    const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
    const todo = tasks.filter(t => t.status === 'TODO' || t.status === 'BACKLOG').length;
    const review = tasks.filter(t => t.status === 'REVIEW').length;

    return { total, completed, inProgress, todo, review };
  }, [tasks]);

  // Calculate project health. Computed for an empty project too — the card
  // renders it as "Not scored" rather than as a perfect 100 — so the section
  // keeps its height instead of collapsing once the tasks arrive.
  const projectHealth = React.useMemo(() => {
    if (!project) return null;
    return calculateProjectHealth(project, tasks);
  }, [project, tasks]);

  if (isLoading) {
    return <PageLoader message="Loading project..." />;
  }

  // A failed request is not a missing project: without this the "not found"
  // card below claimed the project did not exist whenever the fetch broke.
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/projects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <ErrorState
          title="Couldn't load this project"
          description="The project could not be fetched. Check your connection and try again."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => router.push('/projects')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Project Not Found</CardTitle>
            <CardDescription>
              The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to projects"
              onClick={() => router.push('/projects')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1>
                <Badge variant={getProjectStatusConfig(project.status).badgeVariant}>
                  {getProjectStatusConfig(project.status).label}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {project.shortCode} • {project.methodology === 'SCRUM' ? 'Scrum' : 'Kanban'} Project
              </p>
            </div>
          </div>
        </div>

        <Button onClick={() => router.push(`/requirements?projectId=${project.id}`)}>
          <FileText className="mr-2 h-4 w-4" />
          View Requirements
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.total}</div>
            <p className="text-xs text-muted-foreground">
              All tasks in this project
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.completed}</div>
            <p className="text-xs text-muted-foreground">
              {taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0}% completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.inProgress}</div>
            <p className="text-xs text-muted-foreground">
              Currently being worked on
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">To Do</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-700 dark:text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{taskStats.todo}</div>
            <p className="text-xs text-muted-foreground">
              Backlog and planned tasks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Project Details Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Project Health Card - Full Width.
              The tasks it summarises are a separate request, so this card was
              filling in after the page had painted and dropping half a screen of
              content on top of everything below it (layout shift 0.16 — "poor",
              and by far the worst route in the app). Two changes close that: the
              task request now leaves with the project's (see useTasks above),
              and the card renders its own frame while the numbers are in flight
              at EXACTLY the height it will have once they arrive — so whatever
              window is left, nothing below it moves. */}
          <ProjectHealthCard
            health={projectHealth}
            projectName={project.name}
            loading={tasksPending}
          />

          <div className="grid gap-4 md:grid-cols-2">
            {/* Project Information */}
            <Card>
              <CardHeader>
                <CardTitle>Project Information</CardTitle>
                <CardDescription>Basic details about this project</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Description</div>
                  <p className="text-sm">{project.description || 'No description provided'}</p>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Client Name</div>
                  <p className="text-sm">{project.clientName || 'Not specified'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">Start Date</div>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-4 w-4" />
                      <span>{formatProjectDate(project.startDate) ?? 'Not set'}</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-muted-foreground mb-1">End Date</div>
                    <div className="flex items-center gap-1 text-sm">
                      <Calendar className="h-4 w-4" />
                      <span>{formatProjectDate(project.endDate) ?? 'Not set'}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Methodology</div>
                  <div className="flex items-center gap-2">
                    {project.methodology === 'SCRUM' ? (
                      <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <GitBranch className="h-4 w-4" />
                        <span className="text-sm">Scrum</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
                        <Kanban className="h-4 w-4" />
                        <span className="text-sm">Kanban</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Project Code</div>
                  <Badge variant="outline">{project.shortCode}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Team Members */}
            <Card>
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>People working on this project</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {project.memberIds && Array.isArray(project.memberIds) && project.memberIds.length > 0
                      ? `${project.memberIds.length} team member(s)`
                      : 'No team members yet'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Updates */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Updates</CardTitle>
              <CardDescription>
                The tasks, epics and sprints changed most recently
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentUpdates.length > 0 ? (
                <div className="space-y-2">
                  {recentUpdates.map(row => (
                    <div
                      key={`${row.kind}-${row.id}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs shrink-0">
                          {row.ref ?? row.kind}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{row.title}</p>
                          {/* The time is the point of the card: without it there
                              was nothing to tell "recent" from "first on the
                              board". */}
                          <p className="text-xs text-muted-foreground">
                            {row.kind}
                            {row.updatedAt
                              ? ` · updated ${formatDistanceToNow(new Date(row.updatedAt), {
                                  addSuffix: true,
                                })}`
                              : ''}
                          </p>
                        </div>
                      </div>
                      {row.status && (
                        <Badge
                          className="shrink-0"
                          variant={
                            row.status === 'DONE' || row.status === 'COMPLETED'
                              ? 'success'
                              : row.status === 'IN_PROGRESS' || row.status === 'ACTIVE'
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {row.status.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm">No recent updates</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files" className="space-y-4">
          <ProjectFilesPanel workspaceId={project.workspaceId} projectId={project.id} />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Settings</CardTitle>
              <CardDescription>Manage your project configuration</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Configure project details, methodology, status, dates, and more.
              </p>
              <Button onClick={() => router.push(`/projects/${project?.id}/settings`)}>
                <Settings className="h-4 w-4 mr-2" />
                Open Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
