'use client';

import { PageLoader } from '@/components/ui/page-loader';
import {
  getEpicStatusConfig,
  getProjectStatusConfig,
  getSprintStatusConfig,
  getTaskStatusConfig,
} from '@/lib/semantic/status';
import Link from 'next/link';
import { useHasPermissionIn } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { rememberSelectedProject } from '@/hooks/use-project-selection-sync';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { getInitials } from '@/lib/utils';

import * as React from 'react';
import { useParams } from 'next/navigation';
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
import { ArchivedProjectBanner } from '@/components/projects/archived-project-banner';
import {
  ArrowLeft,
  ArrowLeftRight,
  Calendar,
  Users,
  Settings,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { formatProjectDate } from '@/components/projects/project-dates';
import { ProjectHealthCard } from '@/components/projects/project-health-card';
import { ProjectLoadFailure, ProjectNotFound } from '@/components/projects/project-load-failure';
import { calculateProjectHealth } from '@/lib/project-health';
import { useProjectsRealtime, useTasksRealtime, useSprintsRealtime, useEpicsRealtime } from '@/hooks/use-realtime';

/** How many people the "People on This Project" card names before "+N more". */
const PEOPLE_SHOWN = 6;

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  // Fetch by id: resolving through the CURRENT workspace's list reported a
  // perfectly accessible project as missing whenever the selected workspace was
  // a different one (or had not hydrated yet on first paint).
  const { data: project, isLoading, isError, error, refetch } = useProject(projectId);
  // The project somebody opened is the one the tasks, sprints and requirements
  // pages should open on next — they each picked whatever they last showed.
  React.useEffect(() => {
    if (project?.id) rememberSelectedProject(project.id);
  }, [project?.id]);
  // Asked of the PROJECT's workspace, as its settings page asks: asked of the
  // selected one, Settings was offered (or withheld) on the strength of a role
  // in a different workspace from the project's.
  const { allowed: canEditProject } = useHasPermissionIn(
    project?.workspaceId,
    Permission.EDIT_PROJECT
  );
  const { allowed: canManageSettings } = useHasPermissionIn(
    project?.workspaceId,
    Permission.MANAGE_PROJECT_SETTINGS
  );
  const canChangeProject = canEditProject || canManageSettings;

  // Open the project in its own workspace. The Requirements, Epics, Sprints and
  // Tasks links below land on pages that choose from the SELECTED workspace's
  // projects, so for a project from another one (a notification, a search
  // result, a shared link) they could not find it and opened that workspace's
  // first project instead. The bell switches workspace before it navigates for
  // the same reason (notification-center.tsx).
  const {
    currentWorkspaceId,
    workspaces,
    isLoading: workspacesLoading,
    setCurrentWorkspaceId,
  } = useCurrentWorkspace();
  const projectWorkspace = workspaces?.find((w) => w.id === project?.workspaceId);
  const inOtherWorkspace = Boolean(project) && project?.workspaceId !== currentWorkspaceId;
  // Once per project: somebody who then switches away by hand is not dragged
  // back on the next render — they get a button to return instead.
  const [switchedFor, setSwitchedFor] = React.useState<string | null>(null);
  const switching =
    inOtherWorkspace &&
    (workspacesLoading || (Boolean(projectWorkspace) && switchedFor !== project?.id));
  React.useEffect(() => {
    if (!project || !projectWorkspace || project.workspaceId === currentWorkspaceId) return;
    // Not before a workspace is selected at all: useCurrentWorkspace's own
    // effect picks one then, and would land after this switch and undo it.
    if (!currentWorkspaceId || switchedFor === project.id) return;
    setSwitchedFor(project.id);
    setCurrentWorkspaceId(project.workspaceId);
  }, [project, projectWorkspace, currentWorkspaceId, switchedFor, setCurrentWorkspaceId]);
  // The project's own page: its tasks, sprints and epics are other people's
  // work in progress, and this used to show them as they were when it opened.
  useProjectsRealtime(project?.workspaceId);
  useTasksRealtime(projectId);
  useSprintsRealtime(projectId);
  useEpicsRealtime(projectId);
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
  // Who is working on it: everybody a task of this project is assigned to. The
  // card used to count `project.memberIds`, which the create form seeds with
  // whoever made the project and nothing ever updates — so it read "1 team
  // member(s)" for a project ten people were delivering. Then it gave only the
  // count; it names them now, with how much each still has open, busiest first.
  const people = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string; open: number }>();
    for (const task of tasks) {
      (task.assigneeIds ?? []).forEach((id, index) => {
        const person = byId.get(id) ?? { id, name: '', open: 0 };
        // Names are index-aligned with the ids; any task that names somebody will do.
        if (!person.name) person.name = task.assigneeNames?.[index] ?? '';
        if (task.status !== 'DONE') person.open += 1;
        byId.set(id, person);
      });
    }
    // Busiest first; then by name, with anybody whose name is unknown last.
    return [...byId.values()].sort(
      (a, b) =>
        b.open - a.open || Number(!a.name) - Number(!b.name) || a.name.localeCompare(b.name)
    );
  }, [tasks]);
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
    // Review is work under way too. No card showed it, so the cards did not add
    // up to the total beside them (6 done + 2 in progress + 10 to do of 20).
    const underway = inProgress + review;

    return { total, completed, inProgress, todo, review, underway };
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

  // A failed request is not a missing project, and a missing project is not a
  // connection problem — see ProjectLoadFailure: a 404 offered a retry that
  // could only fail again.
  if (isError) {
    return <ProjectLoadFailure error={error} onRetry={() => void refetch()} />;
  }

  if (!project) return <ProjectNotFound />;

  // Held back until the workspace is the project's, so nothing renders with
  // links and permissions that belong to the workspace being left.
  if (switching) {
    return (
      <PageLoader
        message={
          projectWorkspace
            ? `Opening ${project.name} in ${projectWorkspace.name}...`
            : 'Loading project...'
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back to projects"
              asChild
            >
              <Link href="/projects">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1>
                <Badge variant={getProjectStatusConfig(project.status).badgeVariant}>
                  {getProjectStatusConfig(project.status).label}
                </Badge>
              </div>
              <p className="text-muted-foreground">
                {project.shortCode}
              </p>
            </div>
          </div>
        </div>

        {/* Everything the project holds, from here. */}
        <nav aria-label="This project" className="flex flex-wrap items-center gap-2">
          {/* Those pages show the SELECTED workspace's projects, so from any
              other workspace these links would open somebody else's project:
              offer the way back to this one's workspace instead. */}
          {inOtherWorkspace ? (
            projectWorkspace ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentWorkspaceId(projectWorkspace.id)}
              >
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                Switch to {projectWorkspace.name}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                This project is in a workspace you are not a member of, so its requirements,
                epics, sprints and tasks cannot be opened from here.
              </p>
            )
          ) : (
            [
              { label: 'Requirements', href: `/requirements?projectId=${project.id}` },
              { label: 'Epics', href: `/epics?projectId=${project.id}` },
              { label: 'Sprints', href: `/sprints?projectId=${project.id}` },
              { label: 'Tasks', href: `/tasks?projectId=${project.id}` },
            ].map((place) => (
              <Button key={place.label} asChild variant="outline" size="sm">
                <Link href={place.href}>{place.label}</Link>
              </Button>
            ))
          )}
          {canChangeProject && (
            <Button asChild size="sm">
              <Link href={`/projects/${project.id}/settings`}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
          )}
        </nav>
      </div>

      <ArchivedProjectBanner
        projectId={project.id}
        archived={project.status === 'ARCHIVED'}
        workspaceId={project.workspaceId}
      />

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
            <div className="text-2xl font-bold">{taskStats.underway}</div>
            <p className="text-xs text-muted-foreground">
              {taskStats.review > 0
                ? `Being worked on, ${taskStats.review} of them in review`
                : 'Currently being worked on'}
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
          {/* Not for an archived project: it scored "100% Excellent" beside 0%
              complete and recommended giving it dates — an edit the project now
              refuses. Health is a reading of work in progress, and there is none;
              the banner above says what the project is. Known from the same
              response as the page, so leaving it out moves nothing. */}
          {project.status !== 'ARCHIVED' && (
            <ProjectHealthCard
              health={projectHealth}
              projectName={project.name}
              loading={tasksPending}
            />
          )}

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
                  <div className="text-sm font-medium text-muted-foreground mb-1">Project Code</div>
                  <Badge variant="outline">{project.shortCode}</Badge>
                </div>
              </CardContent>
            </Card>

            {/* Team Members */}
            <Card>
              <CardHeader>
                <CardTitle>People on This Project</CardTitle>
                <CardDescription>Everybody with a task in it</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">
                    {people.length > 0
                      ? `${people.length} ${people.length === 1 ? 'person has' : 'people have'} tasks here`
                      : 'Nobody has been given a task here yet'}
                  </span>
                </div>
                {people.length > 0 && (
                  <ul className="space-y-1.5" aria-label="People on this project">
                    {people.slice(0, PEOPLE_SHOWN).map((person) => {
                      const name = person.name || 'Unknown member';
                      return (
                        <li key={person.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                            >
                              {getInitials(name)}
                            </span>
                            <span className="truncate" title={name}>
                              {name}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {person.open > 0
                              ? `${person.open} open ${person.open === 1 ? 'task' : 'tasks'}`
                              : 'No open tasks'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {people.length > PEOPLE_SHOWN && (
                  <p className="text-xs text-muted-foreground">
                    +{people.length - PEOPLE_SHOWN} more
                  </p>
                )}
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
                    <Link
                      key={`${row.kind}-${row.id}`}
                      href={
                        row.kind === 'Task'
                          ? `/tasks?projectId=${project.id}&taskId=${row.id}`
                          : row.kind === 'Epic'
                            ? `/epics?projectId=${project.id}&epicId=${row.id}`
                            : `/sprints/${row.id}/board`
                      }
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Badge variant="outline" className="font-mono text-xs shrink-0">
                          {row.ref ?? row.kind}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" title={row.title}>{row.title}</p>
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
                      {row.status && (() => {
                        // Each kind in its own words and colours, as on its own page.
                        const status =
                          row.kind === 'Task'
                            ? getTaskStatusConfig(row.status)
                            : row.kind === 'Epic'
                              ? getEpicStatusConfig(row.status)
                              : getSprintStatusConfig(row.status);
                        return (
                          <Badge className={`shrink-0 ${status.badgeClassName}`} variant={status.badgeVariant}>
                            {status.label}
                          </Badge>
                        );
                      })()}
                    </Link>
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

      </Tabs>
    </div>
  );
}
