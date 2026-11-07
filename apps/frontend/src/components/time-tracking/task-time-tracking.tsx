'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Clock, Play, Pause, Square, Trash2, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  MAX_ENTRY_SECONDS,
  useTaskTimeSummary,
  useActiveTimer,
  useDiscardTimer,
  useStartTimer,
  useToggleTimer,
  useStopTimer,
} from '@/hooks/use-time-entry';
import { useConfirm } from '@/components/providers/confirm-provider';
import { ManualTimeEntryDialog } from './manual-time-entry-dialog';
import { cn } from '@/lib/utils';
import { formatDuration, formatMinutesHuman } from '@/lib/utils/time-format';
import { searchResultUrl } from '@/lib/search-result-url';
import type { Task } from '@/types';

/** A `datetime-local` value for an instant, on the viewer's clock. */
const toLocalInput = (ms: number) => format(new Date(ms), "yyyy-MM-dd'T'HH:mm");

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
  workspaceId: string;
}

export function TaskTimeTracking({
  task,
  userId,
  workspaceId,
}: TaskTimeTrackingProps) {
  // Everybody's time on the task, not only the viewer's own entries — see
  // useTaskTimeSummary. The card's heading is "Total Logged", and until now it
  // was the total of whoever happened to be looking.
  const { data: summary } = useTaskTimeSummary(task.id);
  // No poll: the header already subscribes to timer frames (useActiveTimerRealtime),
  // and the timer's own start/stop mutations refresh this query.
  const { data: activeTimer } = useActiveTimer(userId, { poll: false });

  const startTimerMutation = useStartTimer();
  const toggleTimerMutation = useToggleTimer();
  const stopTimerMutation = useStopTimer();
  const discardTimerMutation = useDiscardTimer();
  const confirm = useConfirm();
  /** When the work stopped, for a timer left running past a day (datetime-local). */
  const [stoppedAt, setStoppedAt] = React.useState('');

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

  /**
   * A timer left running for more than a day — over a weekend, say. One entry
   * covers at most 24 hours, so the API refuses to file it as it stands (it
   * used to file all 64 hours for an approver to wave through). Its owner says
   * when they actually stopped, and the run is logged up to then.
   */
  const isTooLong = isTimerRunningForThisTask && elapsedSeconds > MAX_ENTRY_SECONDS;
  const startedAtMs = activeTimer ? new Date(activeTimer.startTime).getTime() : NaN;
  /** What the stated end would log, in seconds — paused time left out as the server leaves it out. */
  const statedSeconds = React.useMemo(() => {
    if (!activeTimer || !stoppedAt) return null;
    const end = new Date(stoppedAt).getTime();
    if (Number.isNaN(end) || Number.isNaN(startedAtMs)) return null;
    const pausedAt = activeTimer.isPaused && activeTimer.pausedAt ? new Date(activeTimer.pausedAt).getTime() : NaN;
    const runningPause = Number.isNaN(pausedAt) ? 0 : Math.max(0, (end - pausedAt) / 1000);
    return Math.round((end - startedAtMs) / 1000 - (activeTimer.totalPausedTime ?? 0) - runningPause);
  }, [activeTimer, stoppedAt, startedAtMs]);
  const stoppedAtProblem =
    !stoppedAt || statedSeconds === null
      ? null
      : new Date(stoppedAt).getTime() <= startedAtMs
        ? 'That is before the timer started.'
        : new Date(stoppedAt).getTime() > now
          ? 'That has not happened yet.'
          : statedSeconds > MAX_ENTRY_SECONDS
            ? `That still makes ${formatDuration(statedSeconds)} — one entry covers at most 24 hours. Pick an earlier time, and log the rest by hand.`
            : null;

  const totalMinutes = summary?.totalMinutes ?? 0;
  const billableMinutes = summary?.billableMinutes ?? 0;
  const approvedMinutes = summary?.approvedMinutes ?? 0;
  const myMinutes = summary?.mine.totalMinutes ?? 0;
  const people = summary?.people ?? 0;

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
  const handleStartTimer = (replace = false) => {
    startTimerMutation.mutate({
      userId,
      replace,
      taskId: task.id,
      projectId: task.projectId,
      description: `Working on ${task.hierarchyId}`,
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

  const handleStopTimer = (endTime?: string) => {
    if (!activeTimer) return;

    stopTimerMutation.mutate({
      userId,
      workspaceId,
      taskId: task.id,
      isBillable: false,
      ...(endTime ? { endTime } : {}),
    });
  };

  const handleDiscardTimer = async () => {
    if (!activeTimer) return;
    const ok = await confirm({
      title: 'Discard this timer?',
      description: `${formatDuration(elapsedSeconds)} is thrown away and nothing is logged.`,
      confirmText: 'Discard',
      destructive: true,
    });
    if (ok) discardTimerMutation.mutate({ id: activeTimer.id, userId });
  };

  /**
   * A timer elsewhere whose workspace its owner can no longer log time in can
   * only be discarded — the switch does that instead of logging it (the API
   * decides; this only says so before the click rather than after).
   */
  const otherTimerBlocked = !isTimerRunningForThisTask && activeTimer?.canLog === false;
  const handleSwitch = async () => {
    if (otherTimerBlocked) {
      const ok = await confirm({
        title: 'Discard that timer and start here?',
        description:
          'You can no longer log time in the workspace that timer was started in, so its time cannot be logged. It is thrown away, and a timer starts on this task.',
        confirmText: 'Discard and Start',
        destructive: true,
      });
      if (!ok) return;
    }
    handleStartTimer(true);
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
            {/* Whose time this is, when it is not all the viewer's own. */}
            {people > 1 || (people === 1 && myMinutes === 0) ? (
              <div className="text-xs text-muted-foreground mt-1">
                {people === 1 ? 'by 1 person' : `by ${people} people`}
                {myMinutes > 0 && ` · ${formatMinutesHuman(myMinutes)} yours`}
              </div>
            ) : null}
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
            <Badge>{summary?.entryCount ?? 0}</Badge>
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
              {activeTimer?.canLog === false ? (
                // Stop would only be refused: this person can no longer log time
                // in the workspace the timer was started in. Say so, and offer
                // the one thing that still ends it.
                <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <p>
                    You can no longer log time in the workspace this timer was started in, so its
                    time cannot be logged.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={discardTimerMutation.isPending}
                    onClick={handleDiscardTimer}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Discard
                  </Button>
                </div>
              ) : isTooLong ? (
                <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <p>
                    This timer has been running for {formatDuration(elapsedSeconds)} — longer than one
                    entry can cover (24 hours). When did you stop working?
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor={`timer-stopped-at-${task.id}`}>Stopped working at</Label>
                    <Input
                      id={`timer-stopped-at-${task.id}`}
                      type="datetime-local"
                      value={stoppedAt}
                      min={Number.isNaN(startedAtMs) ? undefined : toLocalInput(startedAtMs)}
                      max={toLocalInput(now)}
                      onChange={(e) => {
                        setStoppedAt(e.target.value);
                        // `now` only ticks while the timer runs; the check below
                        // must not measure "not yet" against a stale clock.
                        setNow(Date.now());
                      }}
                    />
                  </div>
                  {stoppedAtProblem ? (
                    <p className="text-xs text-destructive-text">{stoppedAtProblem}</p>
                  ) : statedSeconds !== null ? (
                    <p className="text-xs text-muted-foreground">
                      Logs {formatDuration(Math.max(0, statedSeconds))}, paused time left out.
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={!stoppedAt || !!stoppedAtProblem || stopTimerMutation.isPending}
                      onClick={() => handleStopTimer(new Date(stoppedAt).toISOString())}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop and log
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={discardTimerMutation.isPending}
                      onClick={handleDiscardTimer}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Discard
                    </Button>
                  </div>
                </div>
              ) : (
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
                    onClick={() => handleStopTimer()}
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
              )}
            </div>
          ) : activeTimer ? (
            // Said where it is and what can be done about it: this read "Timer is
            // running for another task" and offered nothing — not which task,
            // not a way to it, not a way to move the timer here.
            <div className="space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>
                Your timer is {isPaused ? 'paused' : 'running'} on{' '}
                {activeTimer.taskId && !activeTimer.taskMissing ? (
                  <Link
                    href={searchResultUrl({
                      type: 'task',
                      id: activeTimer.taskId,
                      projectId: activeTimer.projectId,
                    })}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {activeTimer.taskHierarchyId || activeTimer.taskTitle || 'another task'}
                  </Link>
                ) : activeTimer.taskId ? (
                  // Its task was deleted: a link would open "not found".
                  <span className="font-medium text-foreground">
                    {activeTimer.taskHierarchyId || activeTimer.taskTitle || 'a task'} (since deleted)
                  </span>
                ) : (
                  <span className="font-medium text-foreground">
                    {activeTimer.description || 'something else'}
                  </span>
                )}
                .
                {otherTimerBlocked &&
                  ' It cannot be logged: you can no longer log time in the workspace it was started in.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void handleSwitch()}
                disabled={startTimerMutation.isPending}
              >
                <Play className="h-4 w-4 mr-2" />
                {otherTimerBlocked ? 'Discard that timer and start here' : 'Log that time and start here'}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => handleStartTimer()}
              disabled={startTimerMutation.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              Start Timer
            </Button>
          )}

          <ManualTimeEntryDialog
            userId={userId}
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
