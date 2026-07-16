'use client';

import { PageHeader } from '@/components/layout/page-header';

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
import { formatDate } from '@/lib/utils';
import { differenceInDays, eachDayOfInterval, format as formatDateFns, parseISO } from 'date-fns';

const COLORS = {
  primary: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  secondary: '#6b7280',
};

export default function SprintAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const sprintId = params.id as string;

  const { data: sprint, isLoading: sprintLoading } = useSprint(sprintId);
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

    const totalPoints = metrics.total; // use total tasks for burndown
    const idealBurnRate = totalPoints / days.length;

    return days.map((day, index) => {
      const dayStr = formatDateFns(day, 'MMM dd');
      const idealRemaining = Math.max(0, totalPoints - idealBurnRate * (index + 1));

      // For actual: simulate based on completion rate (in real app, track daily)
      const progress = Math.min((index + 1) / days.length, metrics.completionRate / 100);
      const actualRemaining = Math.max(0, totalPoints * (1 - progress));

      return {
        date: dayStr,
        ideal: Math.round(idealRemaining),
        actual: Math.round(actualRemaining),
      };
    });
  }, [sprint, metrics]);

  // Status Distribution
  const statusData = [
    { name: 'To Do', value: metrics.todo, color: COLORS.secondary },
    { name: 'In Progress', value: metrics.inProgress, color: COLORS.warning },
    { name: 'Completed', value: metrics.completed, color: COLORS.success },
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
      { name: 'Critical', value: distribution.CRITICAL || 0, color: COLORS.danger },
      { name: 'High', value: distribution.HIGH || 0, color: COLORS.warning },
      { name: 'Medium', value: distribution.MEDIUM || 0, color: '#3b82f6' },
      { name: 'Low', value: distribution.LOW || 0, color: COLORS.success },
    ].filter((item) => item.value > 0);
  }, [sprintTasks]);

  // Story Points by Status
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

  // Days remaining
  const daysRemaining = sprint ? differenceInDays(parseISO(sprint.endDate), new Date()) : 0;
  const totalDays = sprint
    ? differenceInDays(parseISO(sprint.endDate), parseISO(sprint.startDate))
    : 0;
  const daysPassed = totalDays - daysRemaining;

  if (sprintLoading || tasksLoading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <p className="text-muted-foreground">Loading analytics...</p>
      </div>
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
                {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Days Remaining</p>
              <p className="text-2xl font-bold">{Math.max(0, daysRemaining)} days</p>
              <Progress value={(daysPassed / totalDays) * 100} className="mt-2" />
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Capacity Used</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.total > 0 ? Math.round((metrics.completed / metrics.total) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.completed} / {metrics.total} tasks
            </p>
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
            <CardDescription>Ideal vs actual story points remaining</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
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
                <Tooltip />
                <Legend />
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
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Priority Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Priority Distribution</CardTitle>
            <CardDescription>Tasks grouped by priority level</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
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
