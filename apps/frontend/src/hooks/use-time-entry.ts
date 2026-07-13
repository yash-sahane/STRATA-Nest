'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import type { TimeEntry, ActiveTimer, TimeEntryStatus } from '@/types';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

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

      const response = await resources.list('time_entries', queries
      );

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

      const response = await resources.list('active_timers', [
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

      const response = await resources.list('time_entries', [
        query.equal('workspaceId', workspaceId),
        query.equal('status', 'PENDING'),
        query.orderDesc('createdAt'),
      ]
      );

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
      billableRate?: number;
      tags?: string[];
    }) => {
      const timeEntry = await resources.create('time_entries', 'unique()',
        {
          ...data,
          type: 'MANUAL',
          status: 'PENDING',
          tags: data.tags ? JSON.stringify(data.tags) : '[]',
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

      // Delete existing timer if any
      if (existingTimers.items.length > 0) {
        await resources.remove('active_timers', existingTimers.items[0].id
        );
      }

      const timer = await resources.create('active_timers', 'unique()',
        {
          ...data,
          startTime: new Date().toISOString(),
          isPaused: false,
          totalPausedTime: 0,
          type: data.type || 'TIMER',
          pomodoroSettings: data.pomodoroSettings ? JSON.stringify(data.pomodoroSettings) : null,
        }
      );

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
    mutationFn: async (data: {
      timerId: string;
      userId: string;
      isPaused: boolean;
      pausedAt?: string;
      totalPausedTime?: number;
    }) => {
      const { timerId, userId, ...updateData } = data;

      const timer = await resources.update('active_timers', timerId,
        updateData
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
      timerId: string;
      userId: string;
      workspaceId: string;
      userName: string;
      userEmail: string;
      taskId?: string;
      taskTitle?: string;
      taskHierarchyId?: string;
      projectId?: string;
      projectName?: string;
      description: string;
      startTime: string;
      totalPausedTime: number;
      isBillable: boolean;
      billableRate?: number;
      type: 'TIMER' | 'POMODORO';
    }) => {
      const endTime = new Date().toISOString();
      const startTime = new Date(data.startTime);
      const endTimeDate = new Date(endTime);

      // Calculate duration in minutes (excluding paused time)
      const totalMinutes = Math.floor((endTimeDate.getTime() - startTime.getTime()) / 1000 / 60);
      const duration = Math.max(0, totalMinutes - data.totalPausedTime);

      // Create time entry
      const timeEntry = await resources.create('time_entries', 'unique()',
        {
          workspaceId: data.workspaceId,
          userId: data.userId,
          userName: data.userName,
          userEmail: data.userEmail,
          taskId: data.taskId || null,
          taskTitle: data.taskTitle || null,
          taskHierarchyId: data.taskHierarchyId || null,
          projectId: data.projectId || null,
          projectName: data.projectName || null,
          description: data.description,
          startTime: data.startTime,
          endTime,
          duration,
          isBillable: data.isBillable,
          billableRate: data.billableRate || null,
          type: data.type,
          status: 'PENDING',
          tags: '[]',
        }
      );

      // Delete active timer
      await resources.remove('active_timers', data.timerId
      );

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
      updates: Partial<TimeEntry>;
    }) => {
      const { id, updates } = data;

      const timeEntry = await resources.update('time_entries', id,
        updates
      );

      return timeEntry as unknown as TimeEntry;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries', variables.userId] });
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
      const timeEntry = await resources.update('time_entries', data.id,
        {
          status: 'APPROVED',
          approvedBy: data.approvedBy,
          approvedAt: new Date().toISOString(),
        }
      );

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
      const timeEntry = await resources.update('time_entries', data.id,
        {
          status: 'REJECTED',
          rejectionReason: data.rejectionReason,
        }
      );

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

