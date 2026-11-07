'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type { TimeEntry, ActiveTimer, TimeEntryStatus } from '@/types';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

/**
 * A PATCH body for one entry — exactly the fields UpdateTimeEntryDto honours.
 * The duration is the server's, from the window.
 */
export type TimeEntryUpdate = {
  startTime?: string;
  endTime?: string;
  description?: string;
  isBillable?: boolean;
  tags?: string[];
};

/**
 * The running timer as `GET /active_timers` answers for it: the timer, plus
 * whether it can still become an entry. A timer outlives what it was started
 * for — its owner can lose the right to log time in its workspace, its task
 * can be deleted — and these say which, so a screen offers what still works.
 */
export interface RunningTimer extends ActiveTimer {
  workspaceId?: string;
  /** False once stopping it would be refused: it can only be discarded. */
  canLog?: boolean;
  /** Its task has been deleted, so no task card exists to stop it from. */
  taskMissing?: boolean;
}

/** One entry covers at most a day; the API refuses a timer run longer than that. */
export const MAX_ENTRY_SECONDS = 24 * 60 * 60;

// ============================================
// QUERIES
// ============================================

/**
 * Get all time entries for a user
 */
export function useTimeEntries(userId?: string, filters?: {
  workspaceId?: string;
  taskId?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
  status?: TimeEntryStatus;
}) {
  return useQuery({
    queryKey: ['time-entries', userId, filters],
    queryFn: async () => {
      if (!userId) return [];

      const queries = [
        query.equal('userId', userId),
        query.orderDesc('createdAt'),
      ];

      if (filters?.workspaceId) {
        queries.push(query.equal('workspaceId', filters.workspaceId));
      }

      if (filters?.taskId) {
        queries.push(query.equal('taskId', filters.taskId));
      }

      if (filters?.projectId) {
        queries.push(query.equal('projectId', filters.projectId));
      }

      if (filters?.status) {
        queries.push(query.equal('status', filters.status));
      }

      if (filters?.startDate) {
        queries.push(query.greaterThanEqual('startTime', filters.startDate));
      }

      if (filters?.endDate) {
        queries.push(query.lessThanEqual('endTime', filters.endDate));
      }

      // listAll, not list: the API's default page is 100 rows and it is
      // returned with no pager and no marker, so the screen quietly showed
      // the first 100 of however many exist and every total computed from
      // them under-reported.
      const response = await resources.listAll('time_entries', queries);

      return response.items as unknown as TimeEntry[];
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * The caller's own entries in a workspace that START within a day either side
 * of `day` ('YYYY-MM-DD') — every entry a window typed in for that day could
 * overlap, since none covers more than 24 hours. The time-entry dialog checks
 * a window against these before Save, as the API does on it.
 *
 * Keyed under ['time-entries', userId] so every mutation that refreshes the
 * caller's timesheet refreshes this too.
 */
export function useTimeEntriesAround(userId?: string, workspaceId?: string, day?: string) {
  return useQuery({
    queryKey: ['time-entries', userId, 'around', workspaceId, day],
    queryFn: async () => {
      const [y, m, d] = String(day).split('-').map(Number);
      const from = new Date(y, m - 1, d - 1);
      const to = new Date(y, m - 1, d + 2);
      const response = await resources.listAll('time_entries', [
        query.equal('userId', userId as string),
        query.equal('workspaceId', workspaceId as string),
        query.greaterThanEqual('startTime', from.toISOString()),
        query.lessThanEqual('startTime', to.toISOString()),
      ]);
      return response.items as unknown as TimeEntry[];
    },
    enabled: !!userId && !!workspaceId && !!day,
  });
}

/**
 * Whether a window lands on time an entry records as worked — the API's rule
 * (overlapsWorkedTime in time-tracking.services.ts), so the dialog refuses
 * exactly what the server would. A paused timer's entry covers more window than
 * it records and where the pause fell is not stored, so only overlap beyond
 * that gap counts; whole minutes, so windows that merely touch do not clash.
 */
export function overlapsWorkedTime(
  existing: Pick<TimeEntry, 'startTime' | 'endTime' | 'duration'>,
  start: Date,
  end: Date
): boolean {
  const existingStart = new Date(existing.startTime).getTime();
  const existingEnd = new Date(existing.endTime).getTime();
  if (Number.isNaN(existingStart) || Number.isNaN(existingEnd)) return false;
  const overlapMs = Math.min(existingEnd, end.getTime()) - Math.max(existingStart, start.getTime());
  if (overlapMs <= 0) return false;
  const gapMinutes = Math.max(0, (existingEnd - existingStart) / 60_000 - (existing.duration || 0));
  return overlapMs / 60_000 - gapMinutes >= 1;
}

/** Everybody's logged time on one task, as `GET /time_entries/task-summary` answers. */
export interface TaskTimeSummary {
  taskId: string;
  totalMinutes: number;
  billableMinutes: number;
  approvedMinutes: number;
  entryCount: number;
  /** How many people the time is from. */
  people: number;
  mine: { totalMinutes: number; entryCount: number };
}

/**
 * How long a task has taken, counting everybody.
 *
 * The entry list gives a member only their OWN entries — an entry is personal
 * — so a card built on it showed each person their own minutes as the task's
 * total. Keyed under 'time-entries' so every mutation that already refreshes
 * the entry lists refreshes this.
 */
export function useTaskTimeSummary(taskId?: string) {
  return useQuery({
    queryKey: ['time-entries', 'task-summary', taskId],
    queryFn: async (): Promise<TaskTimeSummary> =>
      (await restClient.get('/api/v1/time_entries/task-summary/', {
        params: { taskId },
      })) as TaskTimeSummary,
    enabled: !!taskId,
  });
}

/**
 * Get active timer for a user
 */
export function useActiveTimer(
  userId?: string,
  /**
   * `poll: false` for a reader that is mounted everywhere (the header chip):
   * it is kept current by `useActiveTimerRealtime` instead of by asking again
   * every thirty seconds from every open tab.
   */
  options: { poll?: boolean } = {}
) {
  const poll = options.poll !== false;
  return useQuery({
    queryKey: ['active-timer', userId],
    queryFn: async () => {
      if (!userId) return null;

      const response = await resources.list('active_timers', [query.equal('userId', userId)]
      );

      if (response.items.length === 0) return null;

      return response.items[0] as unknown as RunningTimer;
    },
    enabled: !!userId,
    staleTime: 1000 * 10, // 10 seconds
    // Every 30 seconds, for a reader that asked to be kept updated this way.
    refetchInterval: poll ? 1000 * 30 : false,
  });
}

/** Who approves time in this workspace. */
export function useTimeApprovers(workspaceId?: string) {
  return useQuery({
    queryKey: ['timeApprovers', workspaceId],
    queryFn: async (): Promise<Array<{ userId: string; name: string }>> => {
      if (!workspaceId) return [];
      return (await restClient.get('/api/v1/time_entries/approvers/', {
        params: { workspaceId },
      })) as Array<{ userId: string; name: string }>;
    },
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get pending time entries for approval (managers)
 */
export function usePendingTimeEntries(workspaceId?: string) {
  return useQuery({
    queryKey: ['time-entries', 'pending', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      // listAll, not list: the API's default page is 100 rows and it is
      // returned with no pager and no marker, so the screen quietly showed
      // the first 100 of however many exist and every total computed from
      // them under-reported.
      const response = await resources.listAll('time_entries', [
        query.equal('workspaceId', workspaceId),
        query.equal('status', 'PENDING'),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as TimeEntry[];
    },
    enabled: !!workspaceId,
  });
}

// ============================================
// MUTATIONS
// ============================================

/**
 * Create a manual time entry
 */
export function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      /** Whose list to refresh; the server stamps the entry with the caller. */
      userId: string;
      taskId?: string;
      projectId?: string;
      description: string;
      startTime: string;
      endTime: string;
      isBillable: boolean;
      tags?: string[];
    }) => {
      // Exactly what CreateTimeEntryDto takes. Who logged it, its duration and
      // what its task and project are called are the server's to write.
      const timeEntry = await resources.create('time_entries', {
        workspaceId: data.workspaceId,
        taskId: data.taskId,
        projectId: data.projectId,
        description: data.description,
        startTime: data.startTime,
        endTime: data.endTime,
        isBillable: data.isBillable,
        tags: data.tags ?? [],
      });

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
      // The task's own total is ['time-entries','task-summary',taskId]; the key
      // this used to name matched no query, so "Total Logged" never moved.
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'task-summary', variables.taskId] });
      toast.success('Time entry created successfully');
    },
    onError: (error: unknown) => {
      logger.error('Failed to create time entry', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to create time entry');
    },
  });
}

/**
 * Start a timer
 */
export function useStartTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      userId: string;
      /** The workspace a timer on no task is for; a task's own is read by the server. */
      workspaceId?: string;
      /** Log the running timer's time and start this one in its place. */
      replace?: boolean;
      taskId?: string;
      projectId?: string;
      description: string;
    }) => {
      // Server-owned lifecycle: startTime comes from the server clock, and
      // pause/resume accumulate paused time the client cannot write. A timer
      // already running is the server's to settle too: it refuses, or — with
      // `replace` — logs that time first. This used to DELETE whatever timer
      // was running before starting, so a second tab or device quietly threw
      // away hours that were never filed.
      const timer = await restClient.post('/api/v1/active_timers/start/', {
        workspaceId: data.workspaceId,
        replace: data.replace ?? false,
        taskId: data.taskId,
        projectId: data.projectId,
        description: data.description,
      });

      return timer as unknown as ActiveTimer & {
        /** What became of the timer this one replaced — the server's own words. */
        replaced?: { logged: boolean; message: string };
      };
    },
    onSuccess: (timer, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      if (timer.replaced) {
        queryClient.invalidateQueries({ queryKey: ['time-entries'] });
        // Said as the server decided it. This always claimed the previous time
        // "was logged" — and a timer whose workspace its owner can no longer log
        // time in is discarded instead, which nobody should learn from a total.
        if (timer.replaced.logged) {
          toast.success('Timer switched', { description: timer.replaced.message });
        } else {
          toast.warning('Timer started — the previous one was not logged', {
            description: timer.replaced.message,
          });
        }
      } else {
        toast.success('Timer started');
      }
    },
    onError: (error: unknown) => {
      logger.error('Failed to start timer', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to start timer');
    },
  });
}

/**
 * Pause/Resume timer
 */
export function useToggleTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { userId: string; isPaused: boolean }) => {
      // Dedicated endpoints: the server stamps pausedAt and accumulates
      // totalPausedTime (both are read-only to clients, so a PATCH would be
      // silently dropped and the paused interval billed as worked time).
      const timer = await restClient.post(
        `/api/v1/active_timers/${data.isPaused ? 'pause' : 'resume'}/`
      );

      return timer as unknown as ActiveTimer;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      toast.success(variables.isPaused ? 'Timer paused' : 'Timer resumed');
    },
    onError: (error: unknown) => {
      logger.error('Failed to toggle timer', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to toggle timer');
    },
  });
}

/**
 * Stop timer and create time entry
 */
export function useStopTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      userId: string;
      workspaceId: string;
      taskId?: string;
      isBillable: boolean;
      /**
       * When the work actually stopped, for a timer left running past it (ISO).
       * Absent, the server's clock ends the run.
       */
      endTime?: string;
    }) => {
      // The server closes the timer: it computes the duration from its own
      // clock minus the accumulated paused time, creates the time entry and
      // deletes the timer in one transaction.
      const result = await restClient.post('/api/v1/active_timers/stop/', {
        workspaceId: data.workspaceId,
        isBillable: data.isBillable,
        ...(data.endTime ? { endTime: data.endTime } : {}),
      });

      // A run under a minute comes back as `{ discarded, message }` instead of
      // an entry (see discardedTimerResponse on the API).
      return result as unknown as TimeEntry | { discarded: true; message: string };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
      // The task's own total is ['time-entries','task-summary',taskId]; the key
      // this used to name matched no query, so "Total Logged" never moved.
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'task-summary', variables.taskId] });
      // "Time entry created" was said for a run the server had just discarded.
      if ('discarded' in result) toast.info(result.message);
      else toast.success('Timer stopped and time entry created');
    },
    onError: (error: unknown) => {
      logger.error('Failed to stop timer', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to stop timer');
    },
  });
}

/**
 * Throw the running timer away, logging nothing.
 *
 * The way out for a timer that cannot be stopped into an entry — its owner can
 * no longer log time in its workspace, or its task is gone — and for one that
 * was simply started by mistake. The API asks for no workspace permission here:
 * a person's own clock is always theirs to stop.
 */
export function useDiscardTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string; userId: string }) => {
      await restClient.delete(`/api/v1/active_timers/${data.id}/`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      toast.success('Timer discarded', { description: 'Nothing was logged.' });
    },
    onError: (error: unknown, variables) => {
      // Most likely it was stopped or switched from another tab already: show
      // the timer as it is now rather than the one this screen remembered.
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      logger.error('Failed to discard timer', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to discard timer');
    },
  });
}

/**
 * Update time entry
 */
export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      userId: string;
      updates: TimeEntryUpdate;
    }) => {
      const { id, updates } = data;

      const timeEntry = await resources.update('time_entries', id,
        updates
      );

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: () => {
      // Every time-entry list, not just the owner's: editing an entry that had
      // already been approved or rejected re-opens it as PENDING server-side, so
      // the task card and the approver's queue are stale too.
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry updated');
    },
    onError: (error: unknown) => {
      logger.error('Failed to update time entry', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to update time entry');
    },
  });
}

/**
 * Delete time entry
 */
export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { id: string; userId: string }) => {
      await resources.remove('time_entries', data.id
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
      toast.success('Time entry deleted');
    },
    onError: (error: unknown) => {
      logger.error('Failed to delete time entry', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to delete time entry');
    },
  });
}

/**
 * Approve time entry (managers)
 */
export function useApproveTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      workspaceId: string;
      approvedBy: string;
    }) => {
      // Dedicated approval endpoint: the server authorizes the manager, blocks
      // self-approval and records approver/timestamp itself.
      const timeEntry = await restClient.post(`/api/v1/time_entries/${data.id}/approve/`);

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'pending', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry approved');
    },
    onError: (error: unknown) => {
      logger.error('Failed to approve time entry', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to approve time entry');
    },
  });
}

/**
 * Reject time entry (managers)
 */
export function useRejectTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      workspaceId: string;
      rejectionReason: string;
    }) => {
      // Dedicated rejection endpoint: the server authorizes the manager and
      // records the decision itself.
      const timeEntry = await restClient.post(`/api/v1/time_entries/${data.id}/reject/`, {
        reason: data.rejectionReason,
      });

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'pending', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry rejected');
    },
    onError: (error: unknown) => {
      logger.error('Failed to reject time entry', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to reject time entry');
    },
  });
}

