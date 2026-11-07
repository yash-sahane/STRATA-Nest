'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { useWorkspaceSprints } from '@/hooks/use-sprint';
import { isAssignedTo } from '@/lib/my-tasks';
import { getTaskStatusConfig } from '@/lib/semantic/status';
import Link from 'next/link';
import { useTeamMembers } from '@/hooks/use-team';
import { AttendanceWidget } from '@/components/attendance/attendance-widget';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RowLink } from '@/components/ui/row-activator';
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
import { dueDay } from '@/lib/task-dates';
import { businessDateOf, parseDateOnly } from '@/lib/utils/working-days';
import { differenceInCalendarDays } from 'date-fns';
import { plural } from '@/lib/plural';
import { EmptyState } from '@/components/ui/empty-state';
import { useTasksRealtime, useProjectsRealtime } from '@/hooks/use-realtime';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';

/**
 * Today — the workspace's day, at local midnight — kept current.
 *
 * Every deadline label is relative to "today", and nothing on this page ever
 * re-derived what today is: a dashboard left open overnight — the normal state
 * of a dashboard — kept yesterday's "Due today" until something happened to
 * refetch. It is the WORKSPACE's day (lib/task-dates), which turns over at its
 * own midnight rather than the viewer's, so it is looked at once a minute
 * instead of being scheduled for a local midnight that is not the one that
 * counts. That also picks up the zone once /auth/me has said what it is.
 */
function useTodayStart(): Date {
  const [today, setToday] = React.useState(() => businessDateOf(new Date()));

  React.useEffect(() => {
    const timer = setInterval(() => {
      const now = businessDateOf(new Date());
      setToday((previous) => (previous === now ? previous : now));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return React.useMemo(() => parseDateOnly(today), [today]);
}

/**
 * Whole calendar days from today to a due date, negative once it has passed —
 * both the workspace's days, as every overdue label in the app counts them
 * (lib/task-dates). The previous `Math.ceil((due - Date.now()) / day)` measured
 * from the current clock time, so every overdue task landed on 0 and rendered
 * as "Today", and a task due tomorrow rendered as "1 days".
 */
function daysUntilDue(dueDate: string, todayStart: Date): number {
  const due = dueDay(dueDate);
  return due ? differenceInCalendarDays(due, todayStart) : 0;
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
  if (daysUntil <= 2) return { label: plural(daysUntil, 'day'), variant: 'destructive' };
  if (daysUntil <= 7) return { label: plural(daysUntil, 'day'), variant: 'default' };
  return { label: plural(daysUntil, 'day'), variant: 'secondary' };
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
  // The first screen anybody sees, and the one left open all day: a task
  // assigned or finished elsewhere has to change these figures as it happens.
  useTasksRealtime(currentWorkspace?.id);
  useProjectsRealtime(currentWorkspace?.id);

  // The workspace roster, not the union of project.memberIds: memberIds is a
  // per-project list nothing keeps in sync with membership (the create form
  // seeds it with the owner alone, an import leaves it empty), so this KPI read
  // 1 — or 0 — for a four-person workspace and contradicted the identically
  // named card on /analytics, which counts this same roster.
  const { data: teamMembers = [], isLoading: membersLoading } = useTeamMembers(
    currentWorkspace?.id
  );

  const seesTeamDeadlines = useHasPermission(Permission.VIEW_TEAM_ANALYTICS);

  const { data: workspaceSprints = [] } = useWorkspaceSprints(currentWorkspace?.id);
  const activeSprints = React.useMemo(
    () => workspaceSprints.filter((sprint) => sprint.status === 'ACTIVE').slice(0, 3),
    [workspaceSprints]
  );

  // Work somebody can still do. An archived project is read-only — nothing in it
  // can be finished or re-dated — so its open tasks sat in "My Tasks" and the
  // deadline list as overdue for good. They stay in the totals, which are a
  // record of the work; they leave the lists, which are a call to act. The Team
  // page's workload figures (GET /tasks/summary) leave them out the same way.
  const liveTasks = React.useMemo(() => {
    const archived = new Set(projects.filter((p) => p.status === 'ARCHIVED').map((p) => p.id));
    return archived.size ? allTasks.filter((t) => !archived.has(t.projectId)) : allTasks;
  }, [projects, allTasks]);

  // Calculate real stats
  const stats = React.useMemo(() => {
    // Active means active. This counted projects still being planned as well,
    // so the card disagreed with the one of the same name on Analytics.
    const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
    const planningProjects = projects.filter((p) => p.status === 'PLANNING').length;
    const completedTasks = allTasks.filter((t) => t.status === 'DONE').length;
    // Open ones — what the list under "My Tasks" shows. The card counted
    // finished tasks too, so it read 14 above a list of 3.
    const myTasks = liveTasks.filter((t) => isAssignedTo(t, user?.id) && t.status !== 'DONE').length;

    return {
      activeProjects,
      planningProjects,
      completedTasks,
      totalTasks: allTasks.length,
      myTasks,
      // Not an unanswered invitation: it grants nothing until it is accepted, so
      // it is not on the team yet (the Team page and Analytics count the same way).
      teamMembers: teamMembers.filter((m) => m.status !== 'INVITED').length,
    };
  }, [projects, allTasks, liveTasks, teamMembers, user]);

  // Get my tasks: soonest due first, undated last.
  const myTasks = React.useMemo(() => {
    return liveTasks
      .filter((t) => isAssignedTo(t, user?.id))
      .filter((t) => t.status !== 'DONE')
      .sort((a, b) => {
        // Undated last, explicitly. The comparator returned 0 whenever either side
        // had no date, which made an undated task "equal" to every dated one: the
        // order was no longer an order, so where the dated ones landed depended on
        // the input, and slice(0, 5) could keep an undated task over the most
        // urgent one.
        if (!a.dueDate || !b.dueDate) return Number(!a.dueDate) - Number(!b.dueDate);
        // parseWireDate, matching the `formatDate` each row prints.
        return parseWireDate(a.dueDate).getTime() - parseWireDate(b.dueDate).getTime();
      })
      .slice(0, 5);
  }, [liveTasks, user]);

  // The five nearest deadlines, soonest first. Overdue ones stay in the list —
  // they are the ones that need acting on — but are labelled as overdue below,
  // which is why this is no longer called "upcoming".
  //
  // Deliberately day-independent: the row's days-until figure is derived at
  // render from `todayStart` instead of being baked in here, so a rollover past
  // midnight relabels the list without waiting on a task refetch.
  const deadlines = React.useMemo(() => {
    const tasksWithDueDates = liveTasks
      .filter((t) => t.dueDate && t.status !== 'DONE')
      // Whose deadlines. Everybody was shown the workspace's five nearest, so a
      // developer's dashboard was mostly other people's due dates. Somebody
      // answerable for the team sees the team's; everyone else sees their own.
      .filter((t) => seesTeamDeadlines || isAssignedTo(t, user?.id))
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
        projectId: task.projectId,
        title: task.title,
        projectName: project?.name || 'Unknown',
        dueDate: task.dueDate!,
      };
    });
  }, [liveTasks, projects, seesTeamDeadlines, user]);

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
      <EmptyState
        title="No workspace found"
        description="Create a workspace to get started."
      />
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeProjects}</div>
            <p className="text-xs text-muted-foreground">
              {stats.planningProjects > 0 ? `${stats.planningProjects} in planning · ` : ''}
              {projects.length} in all
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedTasks}</div>
            <p className="text-xs text-muted-foreground">{stats.totalTasks} total tasks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Open Tasks</CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.myTasks}</div>
            <p className="text-xs text-muted-foreground">Assigned to you, not yet done</p>
          </CardContent>
        </Card>

        <Card>
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
          {/* Two columns, each as tall as its own content. The three cards used
              to share one grid, so the check-in card was stretched to the height
              of the deadlines list beside it — a block of empty card under its
              button — and Quick Actions wrapped onto a row of its own below.
              The left column now stacks check-in and Quick Actions, and
              items-start keeps either column from stretching to the other. */}
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              <AttendanceWidget />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: 'View Projects', href: '/projects', icon: FolderKanban },
                    { label: 'View All Tasks', href: '/tasks', icon: CheckCircle2 },
                    { label: 'View Sprints', href: '/sprints', icon: GitBranch },
                    { label: 'Attendance', href: '/attendance', icon: Clock },
                  ].map(({ label, href, icon: Icon }) => (
                    <Button key={href} asChild className="w-full justify-start" variant="outline">
                      <Link href={href}>
                        <Icon className="mr-2 h-4 w-4" />
                        {label}
                        <ArrowRight className="ml-auto h-4 w-4" />
                      </Link>
                    </Button>
                  ))}
                  {/* The sprints running now: the board most people open first. */}
                  {activeSprints.map((sprint) => (
                    <Button key={sprint.id} asChild className="w-full justify-start" variant="outline">
                      <Link href={`/sprints/${sprint.id}/board`}>
                        <GitBranch className="mr-2 h-4 w-4" />
                        <span className="truncate">
                          {sprint.name}
                          <span className="text-muted-foreground"> · {projects.find((p) => p.id === sprint.projectId)?.name ?? 'board'}</span>
                        </span>
                        <ArrowRight className="ml-auto h-4 w-4" />
                      </Link>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {seesTeamDeadlines ? 'Team Deadlines' : 'My Deadlines'}
                </CardTitle>
                <CardDescription>
                  {seesTeamDeadlines
                    ? 'Overdue and upcoming across the workspace, soonest first'
                    : 'Your overdue and upcoming tasks, soonest first'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {deadlines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deadlines</p>
                ) : (
                  deadlines.map((deadline) => {
                    const badge = deadlineBadge(daysUntilDue(deadline.dueDate, todayStart));

                    return (
                      <Link
                        key={deadline.id}
                        href={`/tasks?projectId=${deadline.projectId}&taskId=${deadline.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={deadline.title}>{deadline.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {deadline.projectName} &middot; {formatDate(deadline.dueDate)}
                          </p>
                        </div>
                        <Badge className="shrink-0" variant={badge.variant}>
                          {badge.label}
                        </Badge>
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>My Tasks</CardTitle>
              <CardDescription>Your open tasks across all projects, soonest due first</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {myTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks assigned to you</p>
              ) : (
                myTasks.map((task) => {
                  const project = projects.find((p) => p.id === task.projectId);
                  const status = getTaskStatusConfig(task.status);

                  return (
                    <div
                      key={task.id}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent cursor-pointer"
                      onClick={() => router.push(`/tasks?projectId=${task.projectId}&taskId=${task.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        {/* A bare <Checkbox /> used to sit here: no `checked`, no
                            `onCheckedChange`, inside a row whose onClick navigates
                            away — so it could not be ticked, and ticking it would
                            have done nothing. Completing a task needs the
                            TODO -> IN_PROGRESS -> REVIEW -> DONE path the server
                            enforces, and DONE is not a transition most roles may
                            make, so a one-click tick here would fail for most
                            users on most tasks. The row opens the task instead. */}
                        <div>
                          <RowLink
                            label={`Open task: ${task.title}`}
                            href={`/tasks?projectId=${task.projectId}&taskId=${task.id}`}
                            className="font-medium"
                          >
                            {task.title}
                          </RowLink>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge variant="outline">{task.hierarchyId}</Badge>
                            <Badge variant={status.badgeVariant} className={status.badgeClassName}>
                              {status.label}
                            </Badge>
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
