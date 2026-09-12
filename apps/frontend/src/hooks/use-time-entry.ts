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
 * Anything else (status, duration, taskId) is dropped by the server's
 * whitelisting pipe or recomputed, so it has no business being in the body.
 *
 * `billableRate` accepts `null` on purpose: an absent key means "leave the
 * stored rate alone", so an explicit `null` is the ONLY way to clear one —
 * `undefined` is dropped by JSON.stringify and the server never sees it.
 */
export type TimeEntryUpdate = {
  startTime?: string;
  endTime?: string;
  description?: string;
  isBillable?: boolean;
  billableRate?: number | null;
  tags?: string[];
};

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
 * Get time entries for a specific task
 */
export function useTaskTimeEntries(taskId?: string) {
  return useQuery({
    queryKey: ['time-entries', 'task', taskId],
    queryFn: async () => {
      if (!taskId) return [];

      // Logged time lives in `time_entries`; `active_timers` holds the caller's
      // single running timer and carries no duration/isBillable/status.
      const response = await resources.listAll('time_entries', [
        query.equal('taskId', taskId),
        query.orderDesc('createdAt'),
      ]
      );

      return response.items as unknown as TimeEntry[];
    },
    enabled: !!taskId,
  });
}

/**
 * Get active timer for a user
 */
export function useActiveTimer(userId?: string) {
  return useQuery({
    queryKey: ['active-timer', userId],
    queryFn: async () => {
      if (!userId) return null;

      const response = await resources.list('active_timers', [query.equal('userId', userId)]
      );

      if (response.items.length === 0) return null;

      return response.items[0] as unknown as ActiveTimer;
    },
    enabled: !!userId,
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: 1000 * 30, // Refetch every 30 seconds to keep timer updated
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
      userId: string;
      userName: string;
      userEmail: string;
      taskId?: string;
      taskTitle?: string;
      taskHierarchyId?: string;
      projectId?: string;
      projectName?: string;
      description: string;
      startTime: string;
      endTime: string;
      duration: number;
      isBillable: boolean;
      /** `null` for "no rate" — see TimeEntryUpdate. */
      billableRate?: number | null;
      tags?: string[];
    }) => {
      const timeEntry = await resources.create('time_entries', 'unique()',
        {
          ...data,
          type: 'MANUAL',
          status: 'PENDING',
          tags: data.tags ?? [],
        }
      );

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'task', variables.taskId] });
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
      taskId?: string;
      taskTitle?: string;
      taskHierarchyId?: string;
      projectId?: string;
      description: string;
      type?: 'TIMER' | 'POMODORO';
      pomodoroSettings?: ActiveTimer['pomodoroSettings'];
    }) => {
      // Check if there's already an active timer
      const existingTimers = await resources.list('active_timers', [query.equal('userId', data.userId)]
      );

      // Delete existing timer if any (the server allows only one per user)
      if (existingTimers.items.length > 0) {
        await resources.remove('active_timers', existingTimers.items[0].id
        );
      }

      // Server-owned lifecycle: startTime comes from the server clock, and
      // pause/resume accumulate paused time the client cannot write.
      const timer = await restClient.post('/api/v1/active_timers/start/', {
        taskId: data.taskId,
        taskTitle: data.taskTitle,
        taskHierarchyId: data.taskHierarchyId,
        projectId: data.projectId,
        description: data.description,
        type: data.type || 'TIMER',
        ...(data.pomodoroSettings ? { pomodoroSettings: data.pomodoroSettings } : {}),
      });

      return timer as unknown as ActiveTimer;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      toast.success('Timer started');
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
      billableRate?: number;
    }) => {
      // The server closes the timer: it computes the duration from its own
      // clock minus the accumulated paused time, creates the time entry and
      // deletes the timer in one transaction.
      const timeEntry = await restClient.post('/api/v1/active_timers/stop/', {
        workspaceId: data.workspaceId,
        isBillable: data.isBillable,
        ...(data.billableRate !== undefined ? { billableRate: data.billableRate } : {}),
      });

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-timer', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
      queryClient.invalidateQueries({ queryKey: ['time-entries', 'task', variables.taskId] });
      toast.success('Timer stopped and time entry created');
    },
    onError: (error: unknown) => {
      logger.error('Failed to stop timer', { error });
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to stop timer');
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

