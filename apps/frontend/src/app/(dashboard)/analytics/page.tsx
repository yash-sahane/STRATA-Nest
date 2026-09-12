'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { getTaskStatusConfig } from '@/lib/semantic/status';
import { legendLabel } from '@/lib/chart-legend';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  Users,
  FolderKanban,
  Target,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  RotateCcw,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageLoader, InlineLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { MetricCard, HealthBadge } from '@/components/analytics/kpi-widgets';
import {
  STATUS_COLORS,
  PRIORITY_COLORS,
  PROJECT_STATUS_COLORS,
  CHART_SERIES_COLORS,
} from '@/components/analytics/chart-colors';
import { ChartTooltip } from '@/components/analytics/chart-tooltip';
import { ChartEmptyState } from '@/components/analytics/chart-empty-state';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useProjects } from '@/hooks/use-project';
import { useWorkspaceTasks } from '@/hooks/use-task';
import {
  useProjectAnalytics,
  useWorkspaceAnalytics,
  useTeamAnalytics,
} from '@/hooks/use-analytics';

const ANALYTICS_VIEWS = ['workspace', 'projects', 'team'] as const;
type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** Pie slice labels. Kept short so they cannot overflow the chart surface. */
const renderPercentLabel = ({ percent }: { percent?: number }) =>
  `${((percent ?? 0) * 100).toFixed(0)}%`;
const renderCountLabel = ({ value }: { value?: number }) => `${value ?? 0}`;

/**
 * Both people-shaped panels on this page are fed by the workspace roster, and
 * that query can fail on its own while tasks load fine — which used to show as
 * a Team Size of 0 and a leaderboard of "Unknown member" rows, with the page
 * still presenting itself as healthy. One notice, rendered wherever the roster
 * matters, so the failure is stated instead of rendered as data.
 */
function RosterErrorNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Member list unavailable</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          The workspace roster didn&apos;t load, so team size is unknown and members appear as ids.
          Figures derived from tasks are unaffected.
        </span>
        {/* Neutral, not destructive-red: retrying a read is not a dangerous
            action, it just happens to live inside a destructive alert. */}
        <Button variant="outline" size="sm" className="text-foreground" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();

  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsError,
    refetch: refetchProjects,
  } = useProjects(currentWorkspace?.id);
  const [selectedProjectId, setSelectedProjectId] = React.useState<string>('');
  // An unrecognised ?view= leaves Radix Tabs with no matching TabsContent — a
  // header above an empty body — so fall back to the default view.
  const requestedView = searchParams.get('view');
  const [activeTab, setActiveTab] = React.useState<AnalyticsView>(
    ANALYTICS_VIEWS.includes(requestedView as AnalyticsView)
      ? (requestedView as AnalyticsView)
      : 'workspace'
  );

  // Mirror the active tab into the URL so a view can be linked and bookmarked.
  const handleTabChange = React.useCallback(
    (value: string) => {
      setActiveTab(value as AnalyticsView);
      router.replace(`/analytics?view=${value}`, { scroll: false });
    },
    [router]
  );

  const { data: projectAnalytics, isLoading: projectAnalyticsLoading } = useProjectAnalytics(
    selectedProjectId,
    currentWorkspace?.id
  );
  const {
    data: workspaceAnalytics,
    isLoading: workspaceLoading,
    isRosterError: workspaceRosterError,
    refetchRoster: refetchWorkspaceRoster,
  } = useWorkspaceAnalytics(currentWorkspace?.id);
  const {
    data: teamAnalytics,
    isLoading: teamLoading,
    isRosterError: teamRosterError,
    refetchRoster: refetchTeamRoster,
  } = useTeamAnalytics(currentWorkspace?.id);
  // Every figure on all three tabs is derived from this one query, so a
  // failure here is a failure of the whole page — not "no activity to report".
  const {
    data: allTasks = [],
    isError: tasksError,
    refetch: refetchTasks,
  } = useWorkspaceTasks(currentWorkspace?.id);

  // Keep the selection valid rather than only initialising it: switching
  // workspaces replaces the project list, and a stale id from the previous
  // workspace shows the placeholder over a dashboard of zeros.
  React.useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId) setSelectedProjectId('');
    } else if (!projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  if (workspacesLoading || projectsLoading) {
    return <PageLoader message="Loading analytics..." />;
  }

  // The loader above is gated on the projects query, so a failed request left
  // the page on "Loading analytics..." indefinitely.
  if (projectsError || tasksError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={BarChart3}
          title="Analytics"
          description="We couldn't load your analytics."
        />
        <ErrorState
          description="Your workspace data is still there — this is a connection problem, not an empty workspace."
          onRetry={() => {
            if (projectsError) void refetchProjects();
            if (tasksError) void refetchTasks();
          }}
        />
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <BarChart3 className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to view analytics</p>
        </div>
      </div>
    );
  }

  const isLoading = workspaceLoading || projectAnalyticsLoading || teamLoading;

  // Chart data with stable per-status colors attached to each entry
  const taskStatusData = [
    { name: 'Backlog', status: 'BACKLOG' },
    { name: 'To Do', status: 'TODO' },
    { name: 'In Progress', status: 'IN_PROGRESS' },
    { name: 'Review', status: 'REVIEW' },
    { name: 'Done', status: 'DONE' },
  ]
    .map(({ name, status }) => ({
      name,
      value: allTasks.filter((t) => t.status === status).length,
      color: STATUS_COLORS[status],
    }))
    .filter((item) => item.value > 0);

  const priorityData = [
    { name: 'Critical', priority: 'CRITICAL' },
    { name: 'High', priority: 'HIGH' },
    { name: 'Medium', priority: 'MEDIUM' },
    { name: 'Low', priority: 'LOW' },
  ].map(({ name, priority }) => ({
    name,
    value: allTasks.filter((t) => t.priority === priority).length,
    color: PRIORITY_COLORS[priority],
  }));

  const projectStatusData = [
    { name: 'Planning', status: 'PLANNING' },
    { name: 'Active', status: 'ACTIVE' },
    { name: 'Completed', status: 'COMPLETED' },
    { name: 'On Hold', status: 'ON_HOLD' },
  ]
    .map(({ name, status }) => ({
      name,
      value: projects.filter((p) => p.status === status).length,
      color: PROJECT_STATUS_COLORS[status],
    }))
    .filter((item) => item.value > 0);

  const projectStatusPieData = projectAnalytics
    ? Object.entries(projectAnalytics.statusDistribution)
        .map(([status, value]) => ({
          name: status.replace('_', ' '),
          value,
          color: STATUS_COLORS[status],
        }))
        .filter((item) => item.value > 0)
    : [];

  const projectPriorityData = projectAnalytics
    ? Object.entries(projectAnalytics.priorityDistribution).map(([priority, value]) => ({
        name: priority,
        value,
        color: PRIORITY_COLORS[priority],
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={BarChart3}
        title="Analytics & Reports"
        description="Comprehensive insights and performance metrics"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
          <TabsTrigger value="workspace">Workspace Overview</TabsTrigger>
          <TabsTrigger value="projects">Project Analytics</TabsTrigger>
          <TabsTrigger value="team">Team Performance</TabsTrigger>
        </TabsList>

        {/* Workspace Overview Tab */}
        <TabsContent value="workspace" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <InlineLoader />
            </div>
          ) : !workspaceAnalytics ||
            (workspaceAnalytics.projects.total === 0 && workspaceAnalytics.tasks.total === 0) ? (
            // The hooks return a populated object of zeros for an empty
            // workspace, so emptiness has to be tested on the numbers.
            <EmptyState
              icon={BarChart3}
              title="No workspace analytics available"
              description="Analytics appear once there is project activity to report on."
            />
          ) : (
            <>
              {workspaceRosterError && (
                <RosterErrorNotice onRetry={() => void refetchWorkspaceRoster()} />
              )}

              {/* KPI Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Active Projects"
                  value={workspaceAnalytics.projects.active}
                  icon={FolderKanban}
                />
                <MetricCard
                  title="Total Tasks"
                  value={workspaceAnalytics.tasks.total}
                  icon={CheckCircle2}
                />
                <MetricCard
                  title="Completion Rate"
                  value={`${workspaceAnalytics.tasks.completionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard
                  title="Team Members"
                  value={workspaceAnalytics.team.size ?? '—'}
                  subtitle={`${workspaceAnalytics.team.activeAssignees} with assigned tasks`}
                  icon={Users}
                />
              </div>

              {/* Quick Stats */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Completed Tasks</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.tasks.completed}</p>
                      </div>
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Overdue Tasks</p>
                        <p className="text-2xl font-bold">
                          {
                            allTasks.filter(
                              (t) =>
                                t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'
                            ).length
                          }
                        </p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Active Sprints</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.sprints.active}</p>
                      </div>
                      <Activity className="h-8 w-8 text-blue-500" />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">In Progress</p>
                        <p className="text-2xl font-bold">{workspaceAnalytics.tasks.inProgress}</p>
                      </div>
                      <Clock className="h-8 w-8 text-orange-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Projects Health Overview */}
              <Card>
                <CardHeader>
                  <CardTitle>Projects Health</CardTitle>
                  <CardDescription>Overview of all projects in workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  {projects.length === 0 ? (
                    <EmptyState
                      icon={FolderKanban}
                      title="No projects yet"
                      description="Create a project to start tracking its health."
                    />
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {projects.map((project) => {
                        const projectTasks = allTasks.filter((t) => t.projectId === project.id);
                        const completed = projectTasks.filter(
                          (t) => t.status === 'DONE'
                        ).length;
                        const total = projectTasks.length;
                        const overdue = projectTasks.filter(
                          (t) =>
                            t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'
                        ).length;
                        const completionRate = total > 0 ? (completed / total) * 100 : 0;

                        return (
                          <Card key={project.id}>
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-base">{project.name}</CardTitle>
                                <HealthBadge value={completionRate} />
                              </div>
                            </CardHeader>
                            <CardContent>
                              <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">Progress</span>
                                  <span className="font-medium">{completionRate.toFixed(0)}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className="bg-info h-2 rounded-full transition-all"
                                    style={{ width: `${completionRate}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-sm text-muted-foreground">
                                  <span>
                                    {completed}/{total} tasks
                                  </span>
                                  {overdue > 0 && (
                                    <span className="text-red-500">{overdue} overdue</span>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Charts Row 1 */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Task Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle>Task Distribution</CardTitle>
                    <CardDescription>Tasks by status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {taskStatusData.length === 0 ? (
                      <ChartEmptyState message="No tasks yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart
                          title="Task distribution by status"
                          desc={taskStatusData
                            .map((entry) => `${entry.name}: ${entry.value}`)
                            .join(', ')}
                        >
                          <Pie
                            data={taskStatusData}
                            cx="50%"
                            cy="50%"
                            // These pies are read-only: no onClick, no drill-down.
                            // recharts puts tabIndex=0 on the <g class="recharts-pie">
                            // wrapper by default, adding a second, unlabelled tab stop
                            // on top of the chart surface's own (which carries the
                            // title/desc above and is what keyboard users land on and
                            // arrow through). -1 drops the dead stop without touching
                            // the accessibility layer.
                            rootTabIndex={-1}
                            labelLine={false}
                            // Slice names live in the legend: recharts draws pie
                            // labels 20px outside outerRadius with the text
                            // running further outward, so a name + percent is
                            // wider than the half-card and gets clipped by the
                            // SVG edge (chart margins cannot help — cx stays at
                            // the container centre regardless of them).
                            label={renderPercentLabel}
                            outerRadius={80}
                            dataKey="value"
                          >
                            {taskStatusData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                          <Legend formatter={legendLabel} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Monthly Trends */}
                <Card>
                  <CardHeader>
                    <CardTitle>Monthly Completion Trend</CardTitle>
                    <CardDescription>Tasks completed per month</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart
                        data={workspaceAnalytics.monthlyTrends}
                        title="Monthly task completion trend"
                        desc={workspaceAnalytics.monthlyTrends
                          .map((point) => `${point.month}: ${point.completed}`)
                          .join(', ')}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend formatter={legendLabel} />
                        <Line
                          type="monotone"
                          dataKey="completed"
                          stroke={CHART_SERIES_COLORS[0]}
                          strokeWidth={2}
                          name="Tasks Completed"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Charts Row 2 */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Priority Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Priority Breakdown</CardTitle>
                    <CardDescription>Tasks by priority level</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {allTasks.length === 0 ? (
                      <ChartEmptyState message="No tasks yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart
                          data={priorityData}
                          title="Task count by priority"
                          desc={priorityData
                            .map((entry) => `${entry.name}: ${entry.value}`)
                            .join(', ')}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="value" name="Tasks">
                            {priorityData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Project Status */}
                <Card>
                  <CardHeader>
                    <CardTitle>Project Status</CardTitle>
                    <CardDescription>Distribution of project statuses</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {projectStatusData.length === 0 ? (
                      <ChartEmptyState message="No projects yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart
                          title="Project distribution by status"
                          desc={projectStatusData
                            .map((entry) => `${entry.name}: ${entry.value}`)
                            .join(', ')}
                        >
                          <Pie
                            data={projectStatusData}
                            cx="50%"
                            cy="50%"
                            // Read-only pie — see the Task Distribution chart.
                            rootTabIndex={-1}
                            labelLine={false}
                            // Names in the legend, counts on the slices — see the
                            // Task Distribution chart for why.
                            label={renderCountLabel}
                            outerRadius={80}
                            dataKey="value"
                          >
                            {projectStatusData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                          <Legend formatter={legendLabel} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                  <CardDescription>Latest task updates across workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  {allTasks.length === 0 ? (
                    <EmptyState
                      icon={Activity}
                      title="No activity yet"
                      description="Task updates show up here as work moves along."
                    />
                  ) : (
                    <div className="space-y-4">
                      {[...allTasks]
                        .sort(
                          (a, b) =>
                            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                        )
                        .slice(0, 10)
                        .map((task) => {
                          const project = projects.find((p) => p.id === task.projectId);
                          return (
                            <div
                              key={task.id}
                              className="flex items-start gap-4 pb-4 border-b last:border-0"
                            >
                              <div className="flex-1">
                                <p className="font-medium">{task.title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {project?.name} · Updated{' '}
                                  {new Date(task.updatedAt).toLocaleDateString()}
                                </p>
                              </div>
                              {/* Resolved through the semantic status module, not a
                                  local palette map: this one had REVIEW as purple
                                  while every other surface renders it as the
                                  warning tone. */}
                              <Badge variant={getTaskStatusConfig(task.status).badgeVariant}>
                                {getTaskStatusConfig(task.status).label}
                              </Badge>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Project Analytics Tab */}
        <TabsContent value="projects" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Project Analytics</CardTitle>
                  <CardDescription>Detailed metrics for selected project</CardDescription>
                </div>
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
          </Card>

          {projectAnalyticsLoading ? (
            <div className="flex items-center justify-center py-12">
              <InlineLoader />
            </div>
          ) : !projectAnalytics || !selectedProjectId ? (
            <EmptyState
              icon={BarChart3}
              title="Select a project"
              description="Choose a project above to view its analytics."
            />
          ) : (
            <>
              {/* Project KPIs */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Total Tasks"
                  value={projectAnalytics.totalTasks}
                  icon={Activity}
                />
                <MetricCard
                  title="Completion Rate"
                  value={`${projectAnalytics.completionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard
                  title="Overdue Tasks"
                  value={projectAnalytics.overdueTasks}
                  icon={AlertTriangle}
                />
                <MetricCard
                  title="Estimated Hours"
                  value={`${projectAnalytics.completedEstimatedHours}/${projectAnalytics.totalEstimatedHours}h`}
                  subtitle="Completed / total"
                  icon={Clock}
                />
              </div>

              {/* Project Charts */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Status Distribution</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projectStatusPieData.length === 0 ? (
                      <ChartEmptyState message="No tasks in this project yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart
                          title="Task distribution by status for the selected project"
                          desc={projectStatusPieData
                            .map((entry) => `${entry.name}: ${entry.value}`)
                            .join(', ')}
                        >
                          <Pie
                            data={projectStatusPieData}
                            cx="50%"
                            cy="50%"
                            // Read-only pie — see the Task Distribution chart.
                            rootTabIndex={-1}
                            labelLine={false}
                            label={renderPercentLabel}
                            outerRadius={80}
                            dataKey="value"
                          >
                            {projectStatusPieData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                          <Legend formatter={legendLabel} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Priority Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {projectAnalytics.totalTasks === 0 ? (
                      <ChartEmptyState message="No tasks in this project yet" />
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <BarChart
                          data={projectPriorityData}
                          title="Task count by priority for the selected project"
                          desc={projectPriorityData
                            .map((entry) => `${entry.name}: ${entry.value}`)
                            .join(', ')}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="value" name="Tasks">
                            {projectPriorityData.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Team Performance Tab */}
        <TabsContent value="team" className="space-y-4">
          {teamLoading ? (
            <div className="flex items-center justify-center py-12">
              <InlineLoader />
            </div>
          ) : !teamAnalytics || teamAnalytics.memberPerformance.length === 0 ? (
            // memberPerformance is empty until tasks are assigned; the analytics
            // object itself is never null once the queries have resolved.
            <EmptyState
              icon={BarChart3}
              title="No team performance data available"
              description="Team metrics appear once members start completing work."
            />
          ) : (
            <>
              {teamRosterError && <RosterErrorNotice onRetry={() => void refetchTeamRoster()} />}

              {/* Team KPIs */}
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard
                  title="Total Tasks"
                  value={teamAnalytics.totalTasks}
                  icon={CheckCircle2}
                />
                <MetricCard
                  title="Avg Completion Rate"
                  value={`${teamAnalytics.avgCompletionRate.toFixed(1)}%`}
                  icon={Target}
                />
                <MetricCard
                  title="Team Size"
                  value={teamAnalytics.teamSize ?? '—'}
                  subtitle={`${teamAnalytics.activeAssignees} with assigned tasks`}
                  icon={Users}
                />
              </div>

              {/* Top Performers */}
              <Card>
                <CardHeader>
                  <CardTitle>Team Member Performance</CardTitle>
                  <CardDescription>Individual performance metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[...teamAnalytics.memberPerformance]
                      .sort((a, b) => b.completedTasks - a.completedTasks)
                      .slice(0, 10)
                      .map((member, index) => (
                        <div key={member.memberId} className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="truncate font-medium">{member.memberName}</p>
                              <p className="text-sm text-muted-foreground">
                                {member.completedTasks} / {member.totalTasks} tasks
                              </p>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 bg-muted rounded-full h-2">
                                <div
                                  className="bg-success h-2 rounded-full transition-all"
                                  style={{ width: `${member.completionRate}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-12 text-right">
                                {member.completionRate.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              {/* Workload Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Workload Distribution</CardTitle>
                  <CardDescription>Task distribution across team members</CardDescription>
                </CardHeader>
                <CardContent>
                  {teamAnalytics.workloadDistribution.length === 0 ? (
                    <ChartEmptyState message="No assigned tasks yet" height={300} />
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart
                        data={teamAnalytics.workloadDistribution}
                        title="Task count per team member"
                        desc={teamAnalytics.workloadDistribution
                          .map((entry) => `${entry.memberName}: ${entry.taskCount}`)
                          .join(', ')}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        {/* Names, not ids — a tick is truncated only so a long
                            one cannot overlap its neighbour; the tooltip shows
                            it in full. */}
                        <XAxis
                          dataKey="memberName"
                          tickFormatter={(value: string) =>
                            value.length > 14 ? `${value.slice(0, 13)}\u2026` : value
                          }
                        />
                        <YAxis />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend formatter={legendLabel} />
                        <Bar
                          dataKey="taskCount"
                          fill={CHART_SERIES_COLORS[1]}
                          name="Task Count"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * `useSearchParams` needs a Suspense boundary above it, otherwise the whole
 * route deopts to client-side rendering (and Next fails the build for a
 * statically prerendered route).
 */
export default function AnalyticsPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading analytics..." />}>
      <AnalyticsPageContent />
    </React.Suspense>
  );
}
