'use client';

import { getSprintStatusConfig } from '@/lib/semantic/status';
import { SprintHeader, SprintUnavailable } from '@/components/sprints/sprint-header';
import { sprintFigures, sprintSchedule } from '@/lib/sprint-figures';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useSprint, useUpdateSprint } from '@/hooks/use-sprint';
import { useTasks } from '@/hooks/use-task';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, Target, Zap, CheckCircle2, Clock, Eye } from 'lucide-react';
import {
  LineChart,
  Line,
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
import { plural } from '@/lib/plural';
import { PRIORITY_COLORS, STATUS_COLORS } from '@/components/analytics/chart-colors';
import { ChartEmptyState } from '@/components/analytics/chart-empty-state';
import { ChartTooltip } from '@/components/analytics/chart-tooltip';
import { completionDate } from '@/components/sprints/burndown-chart';
import {
  eachDayOfInterval,
  endOfDay,
  format as formatDateFns,
  parseISO,
} from 'date-fns';
import { businessToday } from '@/lib/task-dates';
import { Textarea } from '@/components/ui/textarea';
import { useHasPermission } from '@/hooks/use-permissions';
import { useIsProjectArchived } from '@/hooks/use-project';
import { Permission } from '@/lib/permissions';
import { basedOnFor } from '@/lib/utils/changed-fields';
import { useSprintsRealtime, useTasksRealtime } from '@/hooks/use-realtime';

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
  const sprintId = params.id as string;

  const {
    data: sprint,
    isLoading: sprintLoading,
    isError: sprintError,
    error: sprintLoadError,
    refetch: refetchSprint,
  } = useSprint(sprintId);
  // Whoever may edit the sprint may write its retrospective — unless its
  // project is archived, and read-only.
  const projectArchived = useIsProjectArchived(sprint?.projectId);
  const canEditSprint = useHasPermission(Permission.EDIT_SPRINT) && !projectArchived;
  useSprintsRealtime(sprint?.projectId);
  useTasksRealtime(sprint?.projectId);
  const {
    data: allTasks,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useTasks(sprint?.projectId);

  // Filter tasks for this sprint
  const sprintTasks = React.useMemo(() => {
    if (!allTasks || !sprintId) return [];
    return allTasks.filter((task) => task.sprintId === sprintId);
  }, [allTasks, sprintId]);

  // Calculate metrics (story points deprecated — use task counts)
  //
  // For a COMPLETED sprint the live counts cannot be trusted: closing a sprint
  // rolls its unfinished tasks out, clearing their sprintId, so `sprintTasks`
  // then holds the DONE ones alone and every completed sprint reported a 100%
  // completion rate. The snapshot the server takes inside the closing
  // transaction is the real record, and is used in preference where present.
  const metrics = React.useMemo(() => {
    const count = (status: string) => sprintTasks.filter((t) => t.status === status).length;

    // The board and the list give the same figures (sprintFigures).
    const figures = sprintFigures(sprint, sprintTasks);
    if (figures.source === 'snapshot') {
      return {
        ...figures,
        // The sprint is closed: nothing is in progress in it any more, and the
        // rest left it to be planned again.
        backlog: 0,
        todo: 0,
        inProgress: 0,
        review: 0,
        rolledOver: Math.max(0, figures.total - figures.completed),
        velocity: figures.completed,
      };
    }
    const completed = count('DONE');
    return {
      ...figures,
      total: sprintTasks.length,
      completed,
      // The board's columns, each its own. Review used to be counted as In
      // Progress here, so this page said 4 in progress beside a board showing
      // In Progress 2 and In Review 2.
      backlog: count('BACKLOG'),
      todo: count('TODO'),
      inProgress: count('IN_PROGRESS'),
      review: count('REVIEW'),
      rolledOver: 0,
      velocity: completed, // velocity expressed as completed tasks
    };
  }, [sprintTasks, sprint]);

  // Burndown Chart Data
  const burndownData = React.useMemo(() => {
    if (!sprint) return [];

    const startDate = parseISO(sprint.startDate);
    const endDate = parseISO(sprint.endDate);
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    // The workspace's day, as the board's due labels count it: a viewer east of
    // the office crossed midnight first and burned down a day early.
    const today = businessToday();

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

  // Status Distribution, in the board's columns and words.
  const statusData = [
    { name: 'Backlog', value: metrics.backlog, color: STATUS_COLORS.BACKLOG },
    { name: 'To Do', value: metrics.todo, color: STATUS_COLORS.TODO },
    { name: 'In Progress', value: metrics.inProgress, color: STATUS_COLORS.IN_PROGRESS },
    { name: 'In Review', value: metrics.review, color: STATUS_COLORS.REVIEW },
    { name: 'Completed', value: metrics.completed, color: STATUS_COLORS.DONE },
    // On a closed sprint the leftovers were not left "To Do" in it — they were
    // rolled back to the backlog when it closed.
    { name: 'Rolled over', value: metrics.rolledOver, color: STATUS_COLORS.TODO },
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

  if (sprintLoading || tasksLoading) {
    return <PageLoader message="Loading sprint analytics..." />;
  }

  // isError BEFORE the not-found branch: a 500 or an offline blip leaves
  // `sprint` undefined exactly like a deleted sprint does. SprintUnavailable
  // tells the two apart — a retry for the blip, a way back for the 404.
  if (sprintError || !sprint) {
    return (
      <SprintUnavailable
        error={sprintError ? sprintLoadError : null}
        onRetry={() => void refetchSprint()}
      />
    );
  }

  const header = (
    <SprintHeader sprint={sprint} current="analytics" description="How the sprint is going: progress, burndown and who is doing what" />
  );

  // Every figure below is counted from the tasks: without them each would read
  // 0, which is a claim about the sprint rather than a failure to load it.
  if (tasksError && !allTasks) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load this sprint's tasks"
          description="Its figures are counted from them. This is a connection or server problem — try again."
          onRetry={() => void refetchTasks()}
        />
      </div>
    );
  }

  // Where the sprint is in its dates, in calendar days with today counted
  // (sprintSchedule). One still open past its last day is overdue, and says by
  // how much rather than "0 days" under a full bar.
  const schedule = sprintSchedule(sprint);
  const overdue = sprint.status !== 'COMPLETED' && schedule.endedDaysAgo > 0;

  return (
    <div className="space-y-6">
      {/* Header — shared by the sprint's three views. */}
      {header}

      {/* Sprint Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Sprint Duration</p>
              <p className="text-2xl font-bold">{plural(schedule.totalDays, 'day')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDateFns(parseISO(sprint.startDate), 'MMM d, yyyy')} -{' '}
                {formatDateFns(parseISO(sprint.endDate), 'MMM d, yyyy')}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Days Remaining</p>
              {sprint.status === 'COMPLETED' ? (
                <>
                  <p className="text-2xl font-bold">Closed</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sprint.completedAt
                      ? `Completed ${formatDateFns(new Date(sprint.completedAt), 'MMM d, yyyy')}`
                      : 'This sprint has been completed'}
                  </p>
                </>
              ) : overdue ? (
                <>
                  <p className="text-2xl font-bold text-warning-text">
                    Ended {plural(schedule.endedDaysAgo, 'day')} ago
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sprint.status === 'ACTIVE'
                      ? 'Overdue — still active past its last day. Complete it to record the result.'
                      : 'Its dates have passed without it being started.'}
                  </p>
                </>
              ) : schedule.startsInDays > 0 ? (
                <>
                  <p className="text-2xl font-bold">{plural(schedule.totalDays, 'day')}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {schedule.startsInDays === 1
                      ? 'Starts tomorrow'
                      : `Starts in ${plural(schedule.startsInDays, 'day')}`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold">
                    {schedule.daysRemaining === 1 ? 'Last day' : plural(schedule.daysRemaining, 'day')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Day {schedule.daysElapsed} of {schedule.totalDays}
                  </p>
                </>
              )}
              <Progress
                aria-label="Sprint time elapsed"
                value={
                  sprint.status === 'COMPLETED' || overdue
                    ? 100
                    : (schedule.daysElapsed / schedule.totalDays) * 100
                }
                indicatorClassName={overdue ? 'bg-warning' : undefined}
                className="mt-2"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <Badge
                className="text-sm"
                variant={sprint.status === 'ACTIVE' ? 'default' : 'secondary'}
              >
                {getSprintStatusConfig(sprint.status).label}
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
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.source === 'unrecorded' ? '—' : `${metrics.completionRate}%`}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.source === 'unrecorded'
                ? 'Not recorded — this sprint was closed before completion figures were kept'
                : `${metrics.completed} of ${metrics.total} tasks`}
              {metrics.source === 'snapshot' && sprint?.rolledOverTaskCount
                ? ` · ${sprint.rolledOverTaskCount} rolled over`
                : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Velocity</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.source === 'unrecorded' ? '—' : metrics.velocity}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.source === 'snapshot' ? 'Completed tasks, at close' : 'Completed tasks'}
            </p>
          </CardContent>
        </Card>

        {/* "Capacity Used" used to live here, but it restated Completion Rate
            exactly (completed/total) under a label implying team capacity — and
            no capacity field exists on Sprint. Show remaining work instead. */}
        {/* On a closed sprint nothing is waiting to start in it: what was
            unfinished left it, back to the backlog. */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {metrics.source === 'snapshot' ? 'Rolled Over' : 'Not Started'}
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.source === 'snapshot' ? metrics.rolledOver : metrics.backlog + metrics.todo}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.source === 'snapshot'
                ? 'Unfinished when it closed, back in the backlog'
                : 'Tasks still in To Do / Backlog'}
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Review</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.review}</div>
            <p className="text-xs text-muted-foreground">Tasks waiting on a review</p>
          </CardContent>
        </Card>
      </div>

      {/* Burndown Chart — the full width: it is the one chart here read over time. */}
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

      {/* The status split used to be drawn twice: a bar chart of three of these
          numbers and this pie of the same three. One is kept — the pie, in the
          board's columns and colours. */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Task Status Distribution</CardTitle>
            <CardDescription>
              {metrics.source === 'snapshot'
                ? 'The tasks as the sprint closed'
                : "The sprint's tasks by board column"}
            </CardDescription>
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
      {(sprint.goal || sprint.retrospectiveNotes || canEditSprint) && (
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
          {(sprint.retrospectiveNotes || canEditSprint) && (
            <RetrospectiveNotes sprint={sprint} canEdit={canEditSprint} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the team took away from the sprint.
 *
 * The notes live on the sprint itself, and until now nothing could write them:
 * completing a sprint is a one-click confirmation, the edit dialog has no such
 * field, and this card only ever appeared once notes existed — which they never
 * could. Anyone who may edit the sprint writes them here, before or after it
 * closes.
 */
function RetrospectiveNotes({
  sprint,
  canEdit,
}: {
  sprint: { id: string; retrospectiveNotes?: string };
  canEdit: boolean;
}) {
  const updateSprint = useUpdateSprint();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const stored = sprint.retrospectiveNotes ?? '';

  const startEditing = () => {
    setDraft(stored);
    setEditing(true);
  };

  const save = async () => {
    const retrospectiveNotes = draft.trim();
    if (retrospectiveNotes === stored) {
      setEditing(false);
      return;
    }
    try {
      await updateSprint.mutateAsync({
        sprintId: sprint.id,
        updates: {
          retrospectiveNotes,
          // What the notes said when editing began, so two people writing at
          // once are told rather than one silently replacing the other.
          basedOn: basedOnFor(sprint as unknown as Record<string, unknown>, {
            retrospectiveNotes,
          }),
        } as Parameters<typeof updateSprint.mutateAsync>[0]['updates'],
      });
      setEditing(false);
    } catch {
      // the mutation toasts the reason; keep what was typed
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Retrospective Notes
        </CardTitle>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            {stored ? 'Edit' : 'Add Notes'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <Textarea
              aria-label="Retrospective notes"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What went well, what to change next time, and what the team will do about it."
              className="min-h-32"
              maxLength={5000}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={updateSprint.isPending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={updateSprint.isPending}>
                {updateSprint.isPending ? 'Saving...' : 'Save Notes'}
              </Button>
            </div>
          </>
        ) : stored ? (
          <p className="text-sm whitespace-pre-wrap">{stored}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing written yet. Record what went well and what to change next time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
