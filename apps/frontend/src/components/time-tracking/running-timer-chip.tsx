'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Pause, Square, Timer, X } from 'lucide-react';
import {
  MAX_ENTRY_SECONDS,
  useActiveTimer,
  useDiscardTimer,
  useStopTimer,
} from '@/hooks/use-time-entry';
import { useActiveTimerRealtime } from '@/hooks/use-realtime';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useConfirm } from '@/components/providers/confirm-provider';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils/time-format';
import { searchResultUrl } from '@/lib/search-result-url';

/** One of the chip's two small action buttons, sharing its border. */
const ACTION =
  'flex w-8 shrink-0 items-center justify-center border-l text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

/**
 * The caller's running timer, wherever they are.
 *
 * A timer is started from a task's own card, and that card was the only place
 * it showed. Close the task, and nothing on any screen said a clock was still
 * counting — until it was noticed hours later and stopped into an entry nobody
 * could vouch for. This sits in the header for as long as a timer exists, shows
 * what it is counting against, and leads back to the task that can stop it.
 *
 * It can also throw the timer away. A timer outlives what it was started for:
 * once its owner lost the right to log time in its workspace, Stop answered 403
 * and so did every switch, and once its task was deleted the only Stop button
 * went with it — while this chip went on ticking and linking to a dead page.
 * Discard needs no permission, so it is always here; and a timer with no task
 * card to stop it from can be stopped and logged from here too.
 *
 * Renders nothing when there is no timer, so the header is unchanged for
 * everybody who is not timing something.
 */
export function RunningTimerChip({ userId, className }: { userId?: string; className?: string }) {
  // Not polled: this is mounted on every page. A timer started or stopped
  // here invalidates the query itself; one changed elsewhere arrives over the
  // realtime channel.
  const { data: timer } = useActiveTimer(userId, { poll: false });
  useActiveTimerRealtime(userId);
  const { currentWorkspace } = useCurrentWorkspace();
  const discard = useDiscardTimer();
  const stop = useStopTimer();
  const confirm = useConfirm();
  const isPaused = Boolean(timer?.isPaused);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!timer || isPaused) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [timer, isPaused]);

  if (!timer || !userId) return null;

  const startedAt = new Date(timer.startTime).getTime();
  // While paused the count holds at the moment it was paused: the server leaves
  // that interval out of the entry it writes. totalPausedTime is SECONDS.
  const upTo = isPaused && timer.pausedAt ? new Date(timer.pausedAt).getTime() : now;
  const elapsed = Number.isNaN(startedAt)
    ? 0
    : Math.max(0, Math.round((upTo - startedAt) / 1000) - (timer.totalPausedTime ?? 0));
  const what = timer.taskHierarchyId || timer.taskTitle || timer.description || 'Timer';
  const Icon = isPaused ? Pause : Timer;

  const blocked = timer.canLog === false;
  const taskGone = Boolean(timer.taskId) && Boolean(timer.taskMissing);
  // A deleted task's page only says "not found"; the timesheet is where its
  // time can be dealt with.
  const href =
    timer.taskId && !taskGone
      ? searchResultUrl({ type: 'task', id: timer.taskId, projectId: timer.projectId })
      : '/time-tracking';
  // Stopping lives on the task's card. With no card to reach, it lives here —
  // unless filing is refused, or the run is longer than one entry may be (the
  // card is where an end time can be given; here it can only be discarded).
  const stoppableHere = (!timer.taskId || taskGone) && !blocked && elapsed <= MAX_ENTRY_SECONDS;
  const problem = blocked
    ? 'It cannot be logged: you can no longer log time in the workspace it was started in.'
    : taskGone
      ? 'Its task has been deleted.'
      : null;
  const busy = discard.isPending || stop.isPending;

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard this timer?',
      description: `${formatDuration(elapsed)} on ${what} is thrown away and nothing is logged.${
        problem ? ` ${problem}` : ' To keep the time, stop it from its task instead.'
      }`,
      confirmText: 'Discard',
      destructive: true,
    });
    if (ok) discard.mutate({ id: timer.id, userId });
  };

  const handleStop = () => {
    const workspaceId = timer.workspaceId || currentWorkspace?.id;
    if (!workspaceId) return;
    stop.mutate({ userId, workspaceId, taskId: timer.taskId, isBillable: false });
  };

  return (
    <div
      className={cn(
        'flex h-9 items-stretch overflow-hidden rounded-md border text-sm',
        problem
          ? 'border-warning/60 text-foreground'
          : isPaused
            ? 'text-muted-foreground'
            : 'border-primary/40 text-foreground',
        className
      )}
    >
      <Link
        href={href}
        aria-label={`${isPaused ? 'Timer paused' : 'Timer running'} on ${what}: ${formatDuration(elapsed)}.${
          problem ? ` ${problem}` : ''
        } Open it.`}
        title={problem ?? (timer.taskTitle || timer.description || undefined)}
        className="flex items-center gap-2 px-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {problem ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-text" />
        ) : (
          <Icon className={cn('h-4 w-4 shrink-0', !isPaused && 'text-primary')} />
        )}
        <span className="tabular-nums font-medium">{formatDuration(elapsed)}</span>
        <span className={cn('max-w-[10rem] truncate text-muted-foreground', taskGone && 'line-through')}>
          {what}
        </span>
      </Link>
      {stoppableHere && (
        <button
          type="button"
          className={ACTION}
          onClick={handleStop}
          disabled={busy}
          aria-label={`Stop the timer on ${what} and log the time`}
          title="Stop and log the time"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        className={cn(ACTION, 'hover:text-destructive-text')}
        onClick={handleDiscard}
        disabled={busy}
        aria-label={`Discard the timer on ${what} without logging it`}
        title="Discard the timer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
