'use client';

import React, { useMemo, useState } from 'react';
import { addDays, format, startOfDay } from 'date-fns';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  overlapsWorkedTime,
  useCreateTimeEntry,
  useTimeEntriesAround,
  useUpdateTimeEntry,
  type TimeEntryUpdate,
} from '@/hooks/use-time-entry';
import { useTasksAssignedTo, useTasksByIds } from '@/hooks/use-task';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { formatMinutesHuman, parseTimeToMinutes } from '@/lib/utils/time-format';
import type { Task, TimeEntry } from '@/types';

/**
 * Stands in for "no task" inside the Select.
 *
 * Radix treats an empty string as the absence of a selection and refuses a
 * SelectItem with that value, so a genuinely optional field needs a sentinel to
 * offer an explicit way back to none. Never leaves this component: it is mapped
 * to '' on the way out.
 */
const NO_TASK = '__none__';

interface ManualTimeEntryDialogProps {
  userId: string;
  taskId?: string;
  trigger?: React.ReactNode;
  /** Supplied to EDIT that entry instead of logging a new one. */
  entry?: TimeEntry;
  /** Controlled open state, for callers with no trigger of their own (the timesheet's Edit action). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * The entry's own timestamps, read on the LOCAL clock. Both fall back rather
 * than returning an Invalid Date: date-fns `format` throws on one, and these
 * seed state during render, so a single malformed row would take the whole
 * timesheet down instead of just opening with today's defaults.
 */
const toLocalDay = (iso: string, fallback: Date) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
};
const toTimeInput = (iso: string, fallback: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : format(d, 'HH:mm');
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * The window a new entry opens on: 09:00–17:00, but ending no later than now.
 * An entry may not end in the future, so a fixed 17:00 made the form open
 * already refused for anyone logging their morning before the day was out.
 */
function defaultWindow(): { start: string; end: string } {
  const current = new Date();
  const nowMinutes = Math.floor((current.getHours() * 60 + current.getMinutes()) / 5) * 5;
  const end = Math.min(17 * 60, nowMinutes);
  return { start: clock(Math.max(0, Math.min(9 * 60, end - 60))), end: clock(end) };
}

export function ManualTimeEntryDialog({
  userId,
  taskId,
  trigger,
  entry,
  open,
  onOpenChange,
}: ManualTimeEntryDialogProps) {
  const isEditing = !!entry;
  // Controlled by the caller when `open` is passed; otherwise the trigger owns it.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  /**
   * What the date and time fields open on, kept so a save can tell whether the
   * window was touched at all. The fields hold minutes; the entry, seconds — and
   * a timer's entry records its window less any time it was paused. Sending the
   * window back on every save made the server recompute the duration from it,
   * so fixing a typo gave a paused entry its pause back, and an entry longer
   * than these fields can show was cut down to whatever they made.
   */
  const [opened] = useState(() =>
    entry
      ? {
          day: format(toLocalDay(entry.startTime, new Date()), 'yyyy-MM-dd'),
          start: toTimeInput(entry.startTime, '09:00'),
          end: toTimeInput(entry.endTime, '17:00'),
        }
      : null
  );
  const [date, setDate] = useState<Date>(() =>
    entry ? toLocalDay(entry.startTime, new Date()) : new Date()
  );
  const [startTime, setStartTime] = useState(() => opened?.start ?? defaultWindow().start);
  const [endTime, setEndTime] = useState(() => opened?.end ?? defaultWindow().end);
  const [selectedTaskId, setSelectedTaskId] = useState(entry?.taskId || taskId || '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [isBillable, setIsBillable] = useState(entry?.isBillable ?? false);
  const [tags, setTags] = useState(entry?.tags?.join(', ') ?? '');

  const { currentWorkspace: workspace } = useCurrentWorkspace();
  // The tasks you might have worked on: yours, and the one this form was
  // opened for. It listed every task in the workspace — a download of all of
  // them, and a select nobody could find anything in.
  const { data: mine = [] } = useTasksAssignedTo(workspace?.id, userId);
  const named = entry?.taskId || taskId || '';
  const { data: namedTask = [] } = useTasksByIds(
    named && !mine.some((t) => t.id === named) ? [named] : []
  );
  const tasks = React.useMemo(() => [...namedTask, ...mine], [namedTask, mine]);
  const createTimeEntryMutation = useCreateTimeEntry();
  const updateTimeEntryMutation = useUpdateTimeEntry();
  const isPending = createTimeEntryMutation.isPending || updateTimeEntryMutation.isPending;

  // One computation, read twice. An end that reads EARLIER than the start is an
  // overnight window, not an invalid one: a timer left running from 23:00 to
  // 01:00 writes exactly that row (the server accepts anything up to 24h), and
  // treating it as `end <= start` made the edit dialog open such an entry
  // reading "0 minutes" with Save permanently disabled — the one row in the
  // timesheet that could not be corrected at all.
  const { durationMinutes, endsNextDay } = useMemo(() => {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);

    // A half-typed or cleared <input type="time"> parses to NaN, which is
    // neither > 0 nor <= 0: the duration line read "NaN minutes" and the submit
    // guard below stopped guarding.
    if (!Number.isFinite(start) || !Number.isFinite(end) || end === start) {
      return { durationMinutes: 0, endsNextDay: false };
    }

    const overnight = end < start;
    return {
      durationMinutes: overnight ? end + MINUTES_PER_DAY - start : end - start,
      endsNextDay: overnight,
    };
  }, [startTime, endTime]);

  // Local midnight, so today's own cell stays selectable — a calendar cell is
  // local midnight and comparing against `new Date()` would disable today.
  const today = useMemo(() => startOfDay(new Date()), []);

  const day = format(date, 'yyyy-MM-dd');
  /** The window as it would be saved. */
  const { windowStart, windowEnd } = useMemo(() => {
    const start = new Date(`${day}T${startTime}:00`);
    const end = new Date(`${day}T${endTime}:00`);
    // An overnight window ends on the FOLLOWING day. setDate on the local date
    // rolls month ends and DST correctly; adding 24h of milliseconds would not.
    if (endsNextDay) end.setDate(end.getDate() + 1);
    return { windowStart: start, windowEnd: end };
  }, [day, startTime, endTime, endsNextDay]);

  /** A new entry always states its window; an edit only once a field of it changes. */
  const windowTouched =
    !opened || day !== opened.day || startTime !== opened.start || endTime !== opened.end;

  // Time is a record of work already done. Nothing stopped the picker walking
  // into May 2027, and the entry was booked, added to Total logged and queued
  // for the manager exactly like a real one. The server refuses a future start
  // ("Time cannot be logged for work that has not happened yet"); this mirrors
  // that rule so the refusal is never reached with a filled-in form.
  const startsInTheFuture =
    !Number.isNaN(windowStart.getTime()) && windowStart.getTime() > Date.now();
  // ...and a future END, which the server refuses too: "today 09:00–17:00"
  // logged at lunchtime was eight hours worked, five of them still to come.
  const endsInTheFuture =
    !startsInTheFuture && !Number.isNaN(windowEnd.getTime()) && windowEnd.getTime() > Date.now();

  // The same person's time, logged twice: the server refuses a window that
  // lands on time already logged in this workspace, by the rule mirrored in
  // overlapsWorkedTime. Checked here against the entries around the chosen day.
  const scopeWorkspaceId = entry?.workspaceId || workspace?.id;
  const { data: nearby = [] } = useTimeEntriesAround(
    isOpen ? userId : undefined,
    scopeWorkspaceId,
    day
  );
  const clash = useMemo(() => {
    if (!windowTouched || durationMinutes <= 0) return null;
    return (
      nearby.find(
        (other) =>
          other.id !== entry?.id &&
          other.status !== 'REJECTED' &&
          overlapsWorkedTime(other, windowStart, windowEnd)
      ) ?? null
    );
  }, [nearby, windowTouched, durationMinutes, entry?.id, windowStart, windowEnd]);

  /** What stops this window being saved, if anything. Unchanged windows are not re-judged. */
  const windowBlocked =
    windowTouched && (durationMinutes <= 0 || startsInTheFuture || endsInTheFuture || !!clash);

  /**
   * The stored entry's own figures, for an edit that leaves the window alone: a
   * timer's entry leaves its paused time out, and an older one may be longer
   * than these fields can show. Either way it is what will still be logged.
   */
  const storedWindowMinutes = entry
    ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60_000)
    : 0;
  const shownMinutes = entry && !windowTouched ? entry.duration : durationMinutes;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!workspace) return;

    if (windowBlocked) {
      return;
    }

    const selectedTask = tasks?.find((t: Task) => t.id === selectedTaskId);

    // Parse tags
    const tagArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      if (entry) {
        // Only what was changed. The server recomputes the duration from a
        // window it is SENT and, for an entry that was already approved or
        // rejected, clears the decision and puts it back in the queue — an
        // approval must never outlive the numbers it signed off. A field left
        // alone is not sent, so a save cannot quietly re-time or re-open an
        // entry over a change nobody made.
        const updates: TimeEntryUpdate = {};
        if (description !== (entry.description ?? '')) updates.description = description;
        if (isBillable !== entry.isBillable) updates.isBillable = isBillable;
        if (tagArray.join('\n') !== (entry.tags ?? []).join('\n')) updates.tags = tagArray;
        if (windowTouched) {
          updates.startTime = windowStart.toISOString();
          updates.endTime = windowEnd.toISOString();
        }
        if (Object.keys(updates).length > 0) {
          await updateTimeEntryMutation.mutateAsync({ id: entry.id, userId, updates });
        }
      } else {
        await createTimeEntryMutation.mutateAsync({
          workspaceId: workspace.id,
          userId,
          taskId: selectedTaskId || undefined,
          projectId: selectedTask?.projectId,
          description,
          startTime: windowStart.toISOString(),
          endTime: windowEnd.toISOString(),
          isBillable,
          tags: tagArray.length > 0 ? tagArray : undefined,
        });
      }
    } catch {
      // The mutation's onError already toasts. Keep the dialog open with the
      // typed values so the entry can be retried instead of re-keyed.
      return;
    }

    setIsOpen(false);

    if (isEditing) {
      // The caller unmounts the dialog on close, so there is nothing to reset —
      // blanking the fields here only flashes an empty form on the way out.
      return;
    }

    // Reset form
    const fresh = defaultWindow();
    setDescription('');
    setStartTime(fresh.start);
    setEndTime(fresh.end);
    if (!taskId) {
      setSelectedTaskId('');
    }
    setIsBillable(false);
    setTags('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {open === undefined && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline">
              <Clock className="h-4 w-4 mr-2" />
              Log Time
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent size="sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Time Entry' : 'Log Time Manually'}</DialogTitle>
            <DialogDescription>
              {!isEditing
                ? 'Record time spent on tasks manually'
                : entry?.status === 'PENDING'
                  ? 'Correct this entry before it is reviewed'
                  : 'Correcting a reviewed entry sends it back for approval'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Date Picker */}
            <div className="space-y-2">
              <Label htmlFor="manual-entry-date">Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="manual-entry-date"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'MMM d, yyyy') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    // `toDate` as well as `disabled`: without it the chevrons
                    // still walk on into 2027 and the whole grid merely looks
                    // greyed out.
                    toDate={today}
                    disabled={(d) => d > today}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-time">End Time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            {windowTouched && startsInTheFuture && (
              <p className="text-sm text-destructive-text">
                Time can only be logged for work that has already happened — pick an earlier date
                or start time.
              </p>
            )}
            {windowTouched && endsInTheFuture && (
              <p className="text-sm text-destructive-text">
                This ends later than now. Log the time once it has been worked — or pick an earlier
                end time.
              </p>
            )}
            {clash && (
              <p className="text-sm text-destructive-text">
                This overlaps time you have already logged:{' '}
                {[clash.taskHierarchyId, clash.taskTitle].filter(Boolean).join(' ') ||
                  clash.projectName ||
                  clash.description ||
                  'another entry'}
                , {format(new Date(clash.startTime), 'MMM d, h:mm a')}–
                {format(new Date(clash.endTime), 'h:mm a')}. Change the times, or edit that entry
                instead.
              </p>
            )}

            {/* Duration Display */}
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">Duration:</span>{' '}
              {formatMinutesHuman(shownMinutes)} ({(shownMinutes / 60).toFixed(2)} hours)
              {windowTouched && endsNextDay && (
                // An overnight window is legitimate, but it is also what a
                // mistyped end time looks like — so name the day it lands on
                // rather than quietly booking an extra 24 hours.
                <span className="text-muted-foreground">
                  {' '}
                  — ends {format(addDays(date, 1), 'MMM d')} (next day)
                </span>
              )}
              {entry && !windowTouched && Math.abs(storedWindowMinutes - entry.duration) >= 1 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {storedWindowMinutes > MINUTES_PER_DAY
                    ? 'This entry is longer than the times above can show.'
                    : 'Paused time is left out of this entry.'}{' '}
                  It stays as it is unless you change the date or times.
                </p>
              )}
            </div>

            {/* Task Selection */}
            {!taskId && (
              <div className="space-y-2">
                <Label htmlFor="task">Task (Optional)</Label>
                <Select
                  // The sentinel exists because Radix reads value="" as "nothing
                  // selected" and throws on a SelectItem carrying it — which is why
                  // there was no way to un-choose a task at all, despite the label
                  // saying the field is optional.
                  value={selectedTaskId || NO_TASK}
                  onValueChange={(next) => setSelectedTaskId(next === NO_TASK ? '' : next)}
                  disabled={isEditing}
                >
                  <SelectTrigger id="task">
                    <SelectValue placeholder="Select a task" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TASK}>No task</SelectItem>
                    {tasks?.map((task: Task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.hierarchyId} - {task.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isEditing && (
                  // PATCH /time_entries/:id carries no taskId, so offering the
                  // change here would drop it silently on save.
                  <p className="text-xs text-muted-foreground">
                    The linked task is fixed. Delete the entry and log it again to move it.
                  </p>
                )}
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What did you work on?"
                rows={3}
                required
              />
            </div>

            {/* Billable */}
            <div className="flex items-center justify-between space-x-2">
              <Label htmlFor="billable" className="cursor-pointer">
                Billable hours
              </Label>
              <Switch
                id="billable"
                checked={isBillable}
                onCheckedChange={setIsBillable}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="meeting, development, review"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!description.trim() || windowBlocked || isPending}
            >
              {isPending
                ? isEditing
                  ? 'Saving...'
                  : 'Logging...'
                : isEditing
                  ? 'Save Changes'
                  : 'Log Time'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
