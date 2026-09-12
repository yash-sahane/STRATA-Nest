'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, TrendingUp, Target, Zap, CheckCircle2, Clock } from 'lucide-react';
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
import { legendLabel } from '@/lib/chart-legend';
import { PRIORITY_COLORS, STATUS_COLORS } from '@/components/analytics/chart-colors';
import { ChartEmptyState } from '@/components/analytics/chart-empty-state';
import { ChartTooltip } from '@/components/analytics/chart-tooltip';
import { completionDate } from '@/components/sprints/burndown-chart';
import {
  differenceInDays,
  eachDayOfInterval,
  endOfDay,
  format as formatDateFns,
  parseISO,
  startOfDay,
} from 'date-fns';

// Design tokens rather than raw hex, so this page speaks the same color language
// as /analytics and adapts to dark mode.
const COLORS = {
  primary: 'hsl(var(--info))',
  secondary: 'hsl(var(--muted-foreground))',
};

/**
 * Pie slice labels. Percent only — recharts draws pie labels 20px outside
 * `outerRadius` and runs the text further outward, so "In Progress: 33%" is
 * wider than the half-card and gets clipped by the SVG edge. Chart margins
 * cannot rescue it (cx stays at the container centre), so the slice NAMES go in
 * a <Legend formatter={legendLabel} /> and only the share is drawn on the chart surface.
 */
const renderPercentLabel = ({ percent }: { percent?: number }) =>
  `${((percent ?? 0) * 100).toFixed(0)}%`;

export default function SprintAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const sprintId = params.id as string;

  const {
    data: sprint,
    isLoading: sprintLoading,
    isError: sprintError,
    refetch: refetchSprint,
  } = useSprint(sprintId);
  const { data: allTasks, isLoading: tasksLoading } = useTasks(sprint?.projectId);

  // Filter tasks for this sprint
  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // Calculate metrics (story points deprecated — use task counts)
  const metrics = React.useMemo(() => {
    const total = sprintTasks.length;
    const completed = sprintTasks.filter((t) => t.status === 'DONE').length;
    const inProgress = sprintTasks.filter(
      (t) => t.status === 'IN_PROGRESS' || t.status === 'REVIEW'
    ).length;
    const todo = sprintTasks.filter((t) => t.status === 'TODO' || t.status === 'BACKLOG').length;

    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const velocity = completed; // velocity expressed as completed tasks

    return {
      total,
      completed,
      inProgress,
      todo,
      completionRate,
      velocity,
    };
  }, [sprintTasks]);

  // Burndown Chart Data
  const burndownData = React.useMemo(() => {
    if (!sprint) return [];

    const startDate = parseISO(sprint.startDate);
    const endDate = parseISO(sprint.endDate);
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const today = startOfDay(new Date());

    const totalPoints = metrics.total; // use total tasks for burndown
    const idealBurnRate = totalPoints / days.length;

    return days.map((day, index) => {
      const dayStr = formatDateFns(day, 'MMM dd');
      const idealRemaining = Math.max(0, totalPoints - idealBurnRate * (index + 1));

      // Actual burndown from the tasks themselves. This used to be synthesised
      // from the completion rate, so the curve tracked the ideal line by
      // construction and a slipping sprint could never look like one. Bucketed
      // on the task's real completion timestamp (updatedAt only as a fallback
      // for rows finished before that column existed).
      const dayEnd = endOfDay(day);
      const completedByDay = sprintTasks.filter(
        (t) => t.status === 'DONE' && new Date(completionDate(t)) <= dayEnd
      ).length;

      return {
        date: dayStr,
        ideal: Math.round(idealRemaining),
        // Don't draw the actual line into the future.
        actual: day <= today ? totalPoints - completedByDay : (null as unknown as number),
      };
    });
  }, [sprint, metrics, sprintTasks]);

  // Status Distribution
  const statusData = [
    { name: 'To Do', value: metrics.todo, color: STATUS_COLORS.TODO },
    { name: 'In Progress', value: metrics.inProgress, color: STATUS_COLORS.IN_PROGRESS },
    { name: 'Completed', value: metrics.completed, color: STATUS_COLORS.DONE },
  ].filter((item) => item.value > 0);

  // Priority Distribution
  const priorityData = React.useMemo(() => {
    const distribution = sprintTasks.reduce(
      (acc, task) => {
        acc[task.priority] = (acc[task.priority] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return [
      { name: 'Critical', value: distribution.CRITICAL || 0, color: PRIORITY_COLORS.CRITICAL },
      { name: 'High', value: distribution.HIGH || 0, color: PRIORITY_COLORS.HIGH },
      { name: 'Medium', value: distribution.MEDIUM || 0, color: PRIORITY_COLORS.MEDIUM },
      { name: 'Low', value: distribution.LOW || 0, color: PRIORITY_COLORS.LOW },
    ].filter((item) => item.value > 0);
  }, [sprintTasks]);

  // Tasks by Status
  const tasksByStatusData = React.useMemo(() => {
    const byStatus = sprintTasks.reduce(
      (acc, task) => {
        const status =
          task.status === 'DONE'
            ? 'Completed'
            : task.status === 'IN_PROGRESS' || task.status === 'REVIEW'
              ? 'In Progress'
              : 'To Do';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return [
      { name: 'To Do', value: byStatus['To Do'] || 0 },
      { name: 'In Progress', value: byStatus['In Progress'] || 0 },
      { name: 'Completed', value: byStatus['Completed'] || 0 },
    ];
  }, [sprintTasks]);

  // Days remaining. `differenceInDays` excludes the start day while the burndown
  // uses an inclusive interval, so +1 keeps the two readouts on this page from
  // contradicting each other (and makes a single-day sprint read "1 day").
  const daysRemaining = sprint ? differenceInDays(parseISO(sprint.endDate), new Date()) : 0;
  const totalDays = sprint
    ? differenceInDays(parseISO(sprint.endDate), parseISO(sprint.startDate)) + 1
    : 0;
  const daysPassed = Math.min(totalDays, Math.max(0, totalDays - daysRemaining));

  if (sprintLoading || tasksLoading) {
    return <PageLoader message="Loading sprint analytics..." />;
  }

  // isError BEFORE the not-found branch. A 500 (or an offline blip) leaves
  // `sprint` undefined exactly like a deleted sprint does, so every sub-page
  // told the user a sprint that plainly exists was "Sprint not found" — a
  // dead end with nothing to retry.
  if (sprintError) {
    return (
      <ErrorState
        className="mt-10"
        title="Couldn't load this sprint"
        description="The sprint is still there — this is a connection problem."
        onRetry={() => void refetchSprint()}
      />
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <p className="text-muted-foreground mb-4">Sprint not found</p>
        <Button onClick={() => router.push('/sprints')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push('/sprints')} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sprints
        </Button>

        <PageHeader
          title={`${sprint.name} Analytics`}
          description="Sprint performance metrics and insights"
          actions={
            <>
              <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/backlog`)}>
                Open Backlog
              </Button>
              <Button variant="outline" onClick={() => router.push(`/sprints/${sprintId}/board`)}>
                Open Board
              </Button>
            </>
          }
        />
      </div>

      {/* Sprint Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Sprint Duration</p>
              <p className="text-2xl font-bold">{totalDays} days</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDateFns(parseISO(sprint.startDate), 'MMM d, yyyy')} -{' '}
                {formatDateFns(parseISO(sprint.endDate), 'MMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Days Remaining</p>
              <p className="text-2xl font-bold">{Math.max(0, daysRemaining)} days</p>
              <Progress
                value={totalDays > 0 ? (daysPassed / totalDays) * 100 : 0}
                className="mt-2"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge
                className="text-sm"
                variant={sprint.status === 'ACTIVE' ? 'default' : 'secondary'}
              >
                {sprint.status}
              </Badge>
              {sprint.goal && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                  Goal: {sprint.goal}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.completionRate}%</div>
            <p className="text-xs text-muted-foreground">
              {metrics.completed} of {metrics.total} tasks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Velocity</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.velocity}</div>
            <p className="text-xs text-muted-foreground">Completed tasks</p>
          </CardContent>
        </Card>

        {/* "Capacity Used" used to live here, but it restated Completion Rate
            exactly (completed/total) under a label implying team capacity — and
            no capacity field exists on Sprint. Show remaining work instead. */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Not Started</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.todo}</div>
            <p className="text-xs text-muted-foreground">Tasks still in To Do / Backlog</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.inProgress}</div>
            <p className="text-xs text-muted-foreground">Tasks being worked on</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Burndown Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Burndown Chart</CardTitle>
            <CardDescription>Ideal vs actual tasks remaining</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={legendLabel} />
                <Line
                  type="monotone"
                  dataKey="ideal"
                  stroke={COLORS.secondary}
                  strokeDasharray="5 5"
                  name="Ideal"
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke={COLORS.primary}
                  strokeWidth={2}
                  name="Actual"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tasks by Status */}
        <Card>
          <CardHeader>
            <CardTitle>Tasks Distribution</CardTitle>
            <CardDescription>Tasks by current status</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tasksByStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={legendLabel} />
                <Bar dataKey="value" fill={COLORS.primary} name="Tasks" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Task Status Distribution</CardTitle>
            <CardDescription>Breakdown of tasks by current status</CardDescription>
          </CardHeader>
          <CardContent>
            {statusData.length === 0 ? (
              <ChartEmptyState message="No tasks in this sprint yet" height={300} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderPercentLabel}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {statusData.map((entry) => (
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

        {/* Priority Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Priority Distribution</CardTitle>
            <CardDescription>Tasks grouped by priority level</CardDescription>
          </CardHeader>
          <CardContent>
            {priorityData.length === 0 ? (
              <ChartEmptyState message="No tasks in this sprint yet" height={300} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={priorityData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderPercentLabel}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {priorityData.map((entry) => (
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

      {/* Sprint Goal & Retrospective */}
      {(sprint.goal || sprint.retrospectiveNotes) && (
        <div className="grid gap-6 md:grid-cols-2">
          {sprint.goal && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Sprint Goal
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{sprint.goal}</p>
              </CardContent>
            </Card>
          )}
          {sprint.retrospectiveNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Retrospective Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{sprint.retrospectiveNotes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
