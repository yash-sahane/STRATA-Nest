'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { useTeamMembers } from '@/hooks/use-team';
import { AttendanceWidget } from '@/components/attendance/attendance-widget';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/layout/page-header';
import {
  CheckCircle2,
  Clock,
  FolderKanban,
  GitBranch,
  Users,
  Calendar,
  Target,
  ArrowRight,
} from 'lucide-react';
import { formatDate, parseWireDate } from '@/lib/utils';
import type { Task } from '@/types';

const DAY_MS = 1000 * 60 * 60 * 24;

/** Local midnight of the day `date` falls on. */
function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Local midnight, recomputed when the clock rolls into a new day.
 *
 * Every deadline label is relative to "today", but nothing on this page ever
 * re-derived what today is: the value was captured when the task list last
 * changed, so a dashboard left open overnight — the normal state of a
 * dashboard — kept yesterday's "Due today" until something happened to
 * refetch. Scheduling to the next local midnight rather than ticking every 24h
 * also keeps it correct across a DST boundary, where a day is 23 or 25 hours.
 */
function useTodayStart(): Date {
  const [todayStart, setTodayStart] = React.useState(() => startOfLocalDay(new Date()));

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const scheduleRollover = () => {
      const nextMidnight = startOfLocalDay(new Date());
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      // A second of slack: firing a hair early would land back on the same day
      // and reschedule with a ~0ms delay.
      timer = setTimeout(
        () => {
          setTodayStart(startOfLocalDay(new Date()));
          scheduleRollover();
        },
        nextMidnight.getTime() - Date.now() + 1000
      );
    };

    scheduleRollover();
    return () => clearTimeout(timer);
  }, []);

  return todayStart;
}

/**
 * Whole calendar days from `todayStart` to a due date, negative once it has
 * passed. The previous `Math.ceil((due - Date.now()) / day)` measured from the
 * current clock time, so every overdue task landed on 0 and rendered as
 * "Today", and a task due tomorrow rendered as "1 days". parseWireDate, not
 * `new Date`, so a date-only value is read as the calendar day the row below
 * prints and not as UTC midnight (a day earlier for every viewer west of UTC).
 */
function daysUntilDue(dueDate: string, todayStart: Date): number {
  const due = startOfLocalDay(parseWireDate(dueDate));
  return Math.round((due.getTime() - todayStart.getTime()) / DAY_MS);
}

/** Label and tone for a deadline that may already have passed. */
function deadlineBadge(daysUntil: number): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
} {
  if (daysUntil < 0) {
    const overdueBy = Math.abs(daysUntil);
    return {
      label: overdueBy === 1 ? '1 day overdue' : `${overdueBy} days overdue`,
      variant: 'destructive',
    };
  }
  if (daysUntil === 0) return { label: 'Due today', variant: 'destructive' };
  if (daysUntil === 1) return { label: 'Tomorrow', variant: 'destructive' };
  if (daysUntil <= 2) return { label: `${daysUntil} days`, variant: 'destructive' };
  if (daysUntil <= 7) return { label: `${daysUntil} days`, variant: 'default' };
  return { label: `${daysUntil} days`, variant: 'secondary' };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  const todayStart = useTodayStart();
  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsError,
    refetch: refetchProjects,
  } = useProjects(currentWorkspace?.id);

  // Get all tasks in the workspace (single query, no hook violations)
  const {
    data: allTasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useWorkspaceTasks(currentWorkspace?.id);

  // The workspace roster, not the union of project.memberIds: memberIds is a
  // per-project list nothing keeps in sync with membership (the create form
  // seeds it with the owner alone, an import leaves it empty), so this KPI read
  // 1 — or 0 — for a four-person workspace and contradicted the identically
  // named card on /analytics, which counts this same roster.
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers(
    currentWorkspace?.id
  );

  // Calculate real stats
  const stats = React.useMemo(() => {
    const activeProjects = projects.filter(
      (p) => p.status === 'ACTIVE' || p.status === 'PLANNING'
    ).length;
    const completedTasks = allTasks.filter((t) => t.status === 'DONE').length;
    const myTasks = allTasks.filter((t) => t.assigneeIds?.includes(user?.id || '')).length;

    return {
      activeProjects,
      completedTasks,
      totalTasks: allTasks.length,
      myTasks,
      teamMembers: teamMembers.length,
    };
  }, [projects, allTasks, teamMembers, user]);

  // Get my tasks
  const myTasks = React.useMemo(() => {
    return allTasks
      .filter((t) => t.assigneeIds?.includes(user?.id || ''))
      .filter((t) => t.status !== 'DONE')
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) {
          // parseWireDate, matching the `formatDate` each row prints.
          return parseWireDate(a.dueDate).getTime() - parseWireDate(b.dueDate).getTime();
        }
        return 0;
      })
      .slice(0, 5);
  }, [allTasks, user]);

  // The five nearest deadlines, soonest first. Overdue ones stay in the list —
  // they are the ones that need acting on — but are labelled as overdue below,
  // which is why this is no longer called "upcoming".
  //
  // Deliberately day-independent: the row's days-until figure is derived at
  // render from `todayStart` instead of being baked in here, so a rollover past
  // midnight relabels the list without waiting on a task refetch.
  const deadlines = React.useMemo(() => {
    const tasksWithDueDates = allTasks
      .filter((t) => t.dueDate && t.status !== 'DONE')
      // parseWireDate on both sides, like the badge and the printed date:
      // `new Date` reads a date-only value as UTC midnight, so sorting by it
      // could order two same-week rows differently from the day counts they
      // are sorted to match.
      .sort((a, b) => parseWireDate(a.dueDate!).getTime() - parseWireDate(b.dueDate!).getTime())
      .slice(0, 5);

    return tasksWithDueDates.map((task) => {
      const project = projects.find((p) => p.id === task.projectId);

      return {
        id: task.id,
        title: task.title,
        projectName: project?.name || 'Unknown',
        dueDate: task.dueDate!,
      };
    });
  }, [allTasks, projects]);

  const getStatusBadge = (status: Task['status']) => {
    const config: Record<
      Task['status'],
      { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
    > = {
      BACKLOG: { label: 'Backlog', variant: 'secondary' },
      TODO: { label: 'To Do', variant: 'outline' },
      IN_PROGRESS: { label: 'In Progress', variant: 'default' },
      REVIEW: { label: 'Review', variant: 'default' },
      DONE: { label: 'Done', variant: 'default' },
    };
    // The API is the source of truth for statuses; a value this build doesn't
    // know about must render as itself, not crash the whole dashboard on
    // `undefined.variant`.
    return config[status] ?? { label: String(status), variant: 'outline' as const };
  };

  if (workspacesLoading || projectsLoading || tasksLoading || membersLoading) {
    return <PageLoader message="Loading your dashboard..." />;
  }

  // Without this the loader above never resolves on a failed request and the
  // dashboard sits on "Loading your dashboard..." forever.
  if (projectsError || tasksError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={FolderKanban}
          title="Dashboard"
          description="We couldn't load your dashboard."
        />
        <ErrorState
          onRetry={() => {
            if (projectsError) refetchProjects();
            if (tasksError) refetchTasks();
          }}
        />
      </div>
    );
  }

  // Show empty state if no workspace
  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'User'}!`}
        description="Here's what's happening with your projects today."
      />

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeProjects}</div>
            <p className="text-xs text-muted-foreground">{projects.length} total projects</p>
          </CardContent>
        </Card>

        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedTasks}</div>
            <p className="text-xs text-muted-foreground">{stats.totalTasks} total tasks</p>
          </CardContent>
        </Card>

        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Tasks</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.myTasks}</div>
            <p className="text-xs text-muted-foreground">Assigned to you</p>
          </CardContent>
        </Card>

        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.teamMembers}</div>
            <p className="text-xs text-muted-foreground">In this workspace</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">My Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Attendance Widget */}
            <AttendanceWidget />

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Deadlines
                </CardTitle>
                <CardDescription>Overdue and upcoming, soonest first</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {deadlines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deadlines</p>
                ) : (
                  deadlines.map((deadline) => {
                    const badge = deadlineBadge(daysUntilDue(deadline.dueDate, todayStart));

                    return (
                      <div
                        key={deadline.id}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{deadline.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {deadline.projectName} &middot; {formatDate(deadline.dueDate)}
                          </p>
                        </div>
                        <Badge className="shrink-0" variant={badge.variant}>
                          {badge.label}
                        </Badge>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/projects')}
                >
                  <FolderKanban className="mr-2 h-4 w-4" />
                  View Projects
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/tasks')}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  View All Tasks
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/sprints')}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  View Sprints
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => router.push('/attendance')}
                >
                  <Clock className="mr-2 h-4 w-4" />
                  Attendance
                  <ArrowRight className="ml-auto h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Tasks</CardTitle>
              <CardDescription>Tasks assigned to you across all projects</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned to you</p>
              ) : (
                myTasks.map((task) => {
                  const project = projects.find((p) => p.id === task.projectId);
                  const status = getStatusBadge(task.status);

                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent cursor-pointer"
                      onClick={() => router.push(`/tasks?projectId=${task.projectId}`)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox />
                        <div>
                          <p className="font-medium">{task.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge variant="outline">{task.hierarchyId}</Badge>
                            <Badge variant={status.variant}>{status.label}</Badge>
                            <span className="text-xs text-muted-foreground">{project?.name}</span>
                          </div>
                        </div>
                      </div>
                      {task.dueDate && (
                        <div className="text-sm text-muted-foreground">
                          Due: {formatDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
