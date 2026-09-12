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
import { useCreateTimeEntry, useUpdateTimeEntry } from '@/hooks/use-time-entry';
import { useWorkspaceTasks } from '@/hooks/use-task';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { parseTimeToMinutes } from '@/lib/utils/time-format';
import type { Task, TimeEntry } from '@/types';

interface ManualTimeEntryDialogProps {
  userId: string;
  userName: string;
  userEmail: string;
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

export function ManualTimeEntryDialog({
  userId,
  userName,
  userEmail,
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

  const [date, setDate] = useState<Date>(() =>
    entry ? toLocalDay(entry.startTime, new Date()) : new Date()
  );
  const [startTime, setStartTime] = useState(() =>
    entry ? toTimeInput(entry.startTime, '09:00') : '09:00'
  );
  const [endTime, setEndTime] = useState(() =>
    entry ? toTimeInput(entry.endTime, '17:00') : '17:00'
  );
  const [selectedTaskId, setSelectedTaskId] = useState(entry?.taskId || taskId || '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [isBillable, setIsBillable] = useState(entry?.isBillable ?? false);
  const [billableRate, setBillableRate] = useState(
    entry?.billableRate != null ? String(entry.billableRate) : ''
  );
  const [tags, setTags] = useState(entry?.tags?.join(', ') ?? '');

  const { currentWorkspace: workspace } = useCurrentWorkspace();
  const { data: tasks } = useWorkspaceTasks(workspace?.id);
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

  // Time is a record of work already done. Nothing stopped the picker walking
  // into May 2027, and the entry was booked, added to Total logged and queued
  // for the manager exactly like a real one. The server refuses a future start
  // ("Time cannot be logged for work that has not happened yet"); this mirrors
  // that rule so the refusal is never reached with a filled-in form.
  const startsInTheFuture = useMemo(() => {
    const startAt = new Date(`${format(date, 'yyyy-MM-dd')}T${startTime}:00`);
    return !Number.isNaN(startAt.getTime()) && startAt.getTime() > Date.now();
  }, [date, startTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!workspace) return;

    if (durationMinutes <= 0 || startsInTheFuture) {
      return;
    }

    const selectedTask = tasks?.find((t: Task) => t.id === selectedTaskId);

    // Create ISO timestamps
    const dateStr = format(date, 'yyyy-MM-dd');
    const startDateTime = new Date(`${dateStr}T${startTime}:00`);
    const endAt = new Date(`${dateStr}T${endTime}:00`);
    // An overnight window ends on the FOLLOWING day. setDate on the local date
    // rolls month ends and DST correctly; adding 24h of milliseconds would not.
    if (endsNextDay) {
      endAt.setDate(endAt.getDate() + 1);
    }

    // `null`, never `undefined`: JSON.stringify drops an undefined key, so the
    // PATCH carried no rate at all and the server (which only copies a rate it
    // was actually sent) left the stored one standing — clearing the box, or
    // switching the entry to non-billable, reported success and changed
    // nothing. A rate also belongs to a billable entry only, so the value still
    // sitting in state behind a switched-off toggle must not be sent.
    const typedRate = Number.parseFloat(billableRate);
    const ratePayload = isBillable && Number.isFinite(typedRate) ? typedRate : null;

    // Parse tags
    const tagArray = tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      if (entry) {
        // The server recomputes duration from the window and, for an entry that
        // was already approved or rejected, clears the decision and puts it back
        // in the queue — an approval must never outlive the numbers it signed off.
        await updateTimeEntryMutation.mutateAsync({
          id: entry.id,
          userId,
          updates: {
            description,
            startTime: startDateTime.toISOString(),
            endTime: endAt.toISOString(),
            isBillable,
            billableRate: ratePayload,
            tags: tagArray,
          },
        });
      } else {
        await createTimeEntryMutation.mutateAsync({
          workspaceId: workspace.id,
          userId,
          userName,
          userEmail,
          taskId: selectedTaskId || undefined,
          taskTitle: selectedTask?.title,
          taskHierarchyId: selectedTask?.hierarchyId,
          projectId: selectedTask?.projectId,
          projectName: undefined,
          description,
          startTime: startDateTime.toISOString(),
          endTime: endAt.toISOString(),
          duration: durationMinutes,
          isBillable,
          billableRate: ratePayload,
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
    setDescription('');
    setStartTime('09:00');
    setEndTime('17:00');
    if (!taskId) {
      setSelectedTaskId('');
    }
    setIsBillable(false);
    setBillableRate('');
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
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !date && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'PPP') : <span>Pick a date</span>}
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

            {startsInTheFuture && (
              <p className="text-sm text-destructive-text">
                Time can only be logged for work that has already happened — pick an earlier date
                or start time.
              </p>
            )}

            {/* Duration Display */}
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">Duration:</span>{' '}
              {durationMinutes} minutes ({(durationMinutes / 60).toFixed(2)} hours)
              {endsNextDay && (
                // An overnight window is legitimate, but it is also what a
                // mistyped end time looks like — so name the day it lands on
                // rather than quietly booking an extra 24 hours.
                <span className="text-muted-foreground">
                  {' '}
                  — ends {format(addDays(date, 1), 'MMM d')} (next day)
                </span>
              )}
            </div>

            {/* Task Selection */}
            {!taskId && (
              <div className="space-y-2">
                <Label htmlFor="task">Task (Optional)</Label>
                <Select
                  value={selectedTaskId}
                  onValueChange={setSelectedTaskId}
                  disabled={isEditing}
                >
                  <SelectTrigger id="task">
                    <SelectValue placeholder="Select a task" />
                  </SelectTrigger>
                  <SelectContent>
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

            {/* Billable Rate */}
            {isBillable && (
              <div className="space-y-2">
                <Label htmlFor="rate">Hourly Rate ($)</Label>
                <Input
                  id="rate"
                  type="number"
                  value={billableRate}
                  onChange={(e) => setBillableRate(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            )}

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
              disabled={
                !description.trim() ||
                durationMinutes <= 0 ||
                startsInTheFuture ||
                isPending
              }
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
