'use client';

import * as React from 'react';
import { Clock, Play, Pause, Square, Trash2, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  useTaskTimeEntries,
  useActiveTimer,
  useStartTimer,
  useToggleTimer,
  useStopTimer,
} from '@/hooks/use-time-entry';
import { ManualTimeEntryDialog } from './manual-time-entry-dialog';
import { cn } from '@/lib/utils';
import { formatDuration, formatMinutesHuman } from '@/lib/utils/time-format';
import type { Task } from '@/types';

/**
 * A run this short logs nothing: the server rounds to the nearest minute and
 * DISCARDS anything that rounds below one, rather than filing a "0m" entry for
 * a manager to approve. The button has to say that before it is pressed —
 * "Stop" on a three-second timer promised an entry that never arrives.
 */
const MIN_LOGGABLE_SECONDS = 30;

interface TaskTimeTrackingProps {
  task: Task;
  userId: string;
  userName: string;
  userEmail: string;
  workspaceId: string;
}

export function TaskTimeTracking({
  task,
  userId,
  userName,
  userEmail,
  workspaceId,
}: TaskTimeTrackingProps) {
  const { data: timeEntries = [] } = useTaskTimeEntries(task.id);
  const { data: activeTimer } = useActiveTimer(userId);

  const startTimerMutation = useStartTimer();
  const toggleTimerMutation = useToggleTimer();
  const stopTimerMutation = useStopTimer();

  // Check if timer is running for this task
  const isTimerRunningForThisTask = activeTimer && activeTimer.taskId === task.id;
  const isPaused = !!activeTimer?.isPaused;

  // A stopwatch with no number on it is not a stopwatch: the card said only
  // "Timer Running" and the member could not tell five minutes from five hours
  // until they stopped it and the entry was already in the approval queue.
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!isTimerRunningForThisTask || isPaused) return;
    // Resync immediately: on resume the first interval tick is a second away
    // and the counter would restart from the value it froze at.
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [isTimerRunningForThisTask, isPaused]);

  const elapsedSeconds = React.useMemo(() => {
    if (!activeTimer) return 0;
    const startedAt = new Date(activeTimer.startTime).getTime();
    if (Number.isNaN(startedAt)) return 0;
    // While paused the count freezes at pausedAt — the server excludes that
    // interval from the entry it writes, so a ticking display would be
    // promising time nobody will be billed for. totalPausedTime is SECONDS.
    const upTo = isPaused && activeTimer.pausedAt ? new Date(activeTimer.pausedAt).getTime() : now;
    return Math.max(0, Math.round((upTo - startedAt) / 1000) - (activeTimer.totalPausedTime ?? 0));
  }, [activeTimer, isPaused, now]);

  const willDiscard = elapsedSeconds < MIN_LOGGABLE_SECONDS;

  // Calculate totals
  const totalMinutes = timeEntries.reduce((sum, entry) => sum + entry.duration, 0);
  const billableMinutes = timeEntries.reduce(
    (sum, entry) => (entry.isBillable ? sum + entry.duration : sum),
    0
  );
  const approvedMinutes = timeEntries.reduce(
    (sum, entry) => (entry.status === 'APPROVED' ? sum + entry.duration : sum),
    0
  );

  // One narrowed local for the whole component. `task.estimatedHours` is
  // `number | undefined` in the type and nullable in the column, and every
  // truthiness test on it treated a real 0 as "no estimate" — while
  // `{task.estimatedHours && …}` short-circuited to the NUMBER 0, which React
  // dutifully printed as a naked "0" in both blocks below.
  const estimatedMinutes = (task.estimatedHours ?? 0) * 60;
  const hasEstimate = estimatedMinutes > 0;

  const progressPercentage = hasEstimate
    ? Math.min((totalMinutes / estimatedMinutes) * 100, 100)
    : 0;

  const isOverEstimate = hasEstimate && totalMinutes > estimatedMinutes;

  // `mutate`, not `mutateAsync`: nothing here awaits the result, and each
  // mutation already reports failure through its own onError toast — awaiting a
  // rejected mutateAsync in a click handler only adds an unhandled rejection.
  const handleStartTimer = () => {
    startTimerMutation.mutate({
      userId,
      taskId: task.id,
      taskTitle: task.title,
      taskHierarchyId: task.hierarchyId,
      projectId: task.projectId,
      description: `Working on ${task.hierarchyId}`,
      type: 'TIMER',
    });
  };

  const handleToggleTimer = () => {
    if (!activeTimer) return;

    // The server accumulates the paused interval itself.
    toggleTimerMutation.mutate({
      userId,
      isPaused: !activeTimer.isPaused,
    });
  };

  const handleStopTimer = () => {
    if (!activeTimer) return;

    stopTimerMutation.mutate({
      userId,
      workspaceId,
      taskId: task.id,
      isBillable: false,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Time Tracking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Total Logged</div>
            <div className="text-2xl font-bold">{formatMinutesHuman(totalMinutes)}</div>
          </div>
          {hasEstimate && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Estimated</div>
              <div className="text-2xl font-bold">
                {formatMinutesHuman(estimatedMinutes)}
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {hasEstimate && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className={isOverEstimate ? 'text-destructive-text font-semibold' : ''}>
                {progressPercentage.toFixed(0)}%
              </span>
            </div>
            <Progress
              value={progressPercentage}
              className={isOverEstimate ? 'h-2 [&>div]:bg-destructive' : 'h-2'}
            />
            {isOverEstimate && (
              <div className="flex items-center gap-1 text-xs text-destructive-text">
                <TrendingUp className="h-3 w-3" />
                Over estimate by {formatMinutesHuman(totalMinutes - estimatedMinutes)}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Breakdown */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Billable Hours</span>
            <Badge variant="secondary">{formatMinutesHuman(billableMinutes)}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Approved Hours</span>
            <Badge variant="outline">{formatMinutesHuman(approvedMinutes)}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Entries</span>
            <Badge>{timeEntries.length}</Badge>
          </div>
        </div>

        <Separator />

        {/* Timer Actions */}
        <div className="space-y-2">
          {isTimerRunningForThisTask ? (
            <div className="space-y-2">
              <div
                className={cn(
                  'flex items-center justify-between gap-2 p-2 rounded-md',
                  isPaused ? 'bg-muted' : 'bg-primary/10'
                )}
              >
                <div className="flex items-center gap-2">
                  {/* The card used to read "Timer Running / Active" while the
                      toast above it said "Timer paused" — only the button label
                      changed. */}
                  <span className="text-sm font-medium">
                    {isPaused ? 'Timer Paused' : 'Timer Running'}
                  </span>
                  <Badge variant={isPaused ? 'secondary' : 'default'}>
                    {isPaused ? 'Paused' : 'Active'}
                  </Badge>
                </div>
                <span className="text-sm font-semibold tabular-nums" title="Elapsed time">
                  {formatDuration(elapsedSeconds)}
                </span>
              </div>
              {willDiscard && (
                <p className="text-xs text-muted-foreground">
                  Under a minute — stopping now discards this run instead of logging it.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleToggleTimer}
                  disabled={toggleTimerMutation.isPending}
                >
                  {isPaused ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={handleStopTimer}
                  disabled={stopTimerMutation.isPending}
                  title={
                    willDiscard
                      ? 'Under a minute of work — this run is discarded, not logged'
                      : undefined
                  }
                >
                  {willDiscard ? (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Discard
                    </>
                  ) : (
                    <>
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : activeTimer ? (
            <div className="p-3 bg-muted rounded-md text-sm text-muted-foreground">
              Timer is {isPaused ? 'paused' : 'running'} for another task
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleStartTimer}
              disabled={startTimerMutation.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              Start Timer
            </Button>
          )}

          <ManualTimeEntryDialog
            userId={userId}
            userName={userName}
            userEmail={userEmail}
            taskId={task.id}
            trigger={
              <Button variant="ghost" size="sm" className="w-full">
                <Clock className="h-4 w-4 mr-2" />
                Log Time Manually
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
