import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { Sprint, Task } from '@/types';
import { toast } from '@/hooks/use-toast';
import { createBulkNotifications } from '@/hooks/use-notification';

export function useSprints(projectId?: string) {
  return useQuery({
    queryKey: ['sprints', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.list('sprints', [
        query.equal('projectId', projectId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as Sprint[];
    },
    enabled: !!projectId,
  });
}

// Hook to get all sprints in a workspace (for calendar)
export function useWorkspaceSprints(workspaceId?: string) {
  return useQuery({
    queryKey: ['workspace-sprints', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      const response = await resources.list('sprints', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
        query.limit(1000),
      ]);

      return response.items as unknown as Sprint[];
    },
    enabled: !!workspaceId,
  });
}

export function useActiveSprint(projectId?: string) {
  return useQuery({
    queryKey: ['sprint', 'active', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const response = await resources.list('sprints', [
        query.equal('projectId', projectId),
        query.equal('status', 'ACTIVE'),
        query.limit(1),
      ]);

      return response.items.length > 0 ? (response.items[0] as unknown as Sprint) : null;
    },
    enabled: !!projectId,
  });
}

export function useSprint(sprintId?: string) {
  return useQuery({
    queryKey: ['sprint', sprintId],
    queryFn: async () => {
      if (!sprintId) return null;

      const response = await resources.get('sprints', sprintId);

      return response as unknown as Sprint;
    },
    enabled: !!sprintId,
  });
}

export function useCreateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      name: string;
      goal?: string;
      startDate: string;
      endDate: string;
      createdBy: string;
      createdByName?: string;
    }) => {
      const response = await resources.create('sprints', id.unique(),
        {
          workspaceId: data.workspaceId,
          projectId: data.projectId,
          name: data.name,
          goal: data.goal || '',
          startDate: data.startDate,
          endDate: data.endDate,
          // capacity removed - sprint workload now measured by task counts
          status: 'PLANNING',
          retrospectiveNotes: '',
          createdBy: data.createdBy,
          createdByName: data.createdByName || '',
        }
      );
      return response as unknown as Sprint;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      toast({
        title: 'Sprint created',
        description: 'The sprint has been created successfully.',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to create sprint',
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sprintId,
      updates,
    }: {
      sprintId: string;
      updates: Partial<
        Omit<
          Sprint,
          'id' | 'createdAt' | 'updatedAt' | 'workspaceId' | 'projectId' | 'createdBy'
        >
      >;
    }) => {
      const response = await resources.update('sprints', sprintId,
        updates
      );
      return response as unknown as Sprint;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', data.projectId] });
      toast({
        title: 'Sprint updated',
        description: 'The sprint has been updated successfully.',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to update sprint',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sprintId }: { sprintId: string; projectId: string }) => {
      await resources.remove('sprints', sprintId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', variables.projectId] });
      toast({
        title: 'Sprint deleted',
        description: 'The sprint has been deleted successfully.',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to delete sprint',
        variant: 'destructive',
      });
    },
  });
}

export function useStartSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sprintId,
      // projectId,
    }: {
      sprintId: string;
      projectId: string;
      teamMemberIds?: string[];
      taskCount?: number;
    }) => {
      // 1. Update sprint status to ACTIVE
      const response = await resources.update('sprints', sprintId,
        { status: 'ACTIVE' }
      );

      // 2. Find all tasks linked to this sprint that are in BACKLOG
      // Tasks get their sprintId set when their FR is assigned to a sprint
      const sprintTasksResponse = await resources.list('tasks', [
        query.equal('sprintId', sprintId),
        query.equal('status', 'BACKLOG'),
        query.limit(500),
      ]);
      const tasksToUpdate = sprintTasksResponse.items as unknown as Task[];

      // Collect assignees to notify
      const assigneesToNotify = new Set<string>();
      tasksToUpdate.forEach((task) => {
        if (task.assignedTo && Array.isArray(task.assignedTo)) {
          task.assignedTo.forEach((userId: string) => {
            if (userId && userId.trim()) assigneesToNotify.add(userId);
          });
        }
      });

      // 3. Update all tasks to TODO status
      const updatePromises = tasksToUpdate.map((task) =>
        resources.update('tasks', task.id, {
          status: 'TODO',
        })
      );

      await Promise.all(updatePromises);

      // Return sprint and metadata for notifications
      return {
        sprint: response as unknown as Sprint,
        tasksUpdated: tasksToUpdate.length,
        assigneeIds: Array.from(assigneesToNotify),
      };
    },
    onSuccess: async (
      result: { sprint: Sprint; tasksUpdated: number; assigneeIds: string[] },
      variables: {
        sprintId: string;
        projectId: string;
        teamMemberIds?: string[];
        taskCount?: number;
      }
    ) => {
      const { sprint, tasksUpdated, assigneeIds } = result;

      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', variables.projectId] });
      // Also invalidate tasks since we updated their status to TODO
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      // Combine team member IDs from variables with assignees from tasks
      const allNotifyIds = new Set<string>([...(variables.teamMemberIds || []), ...assigneeIds]);
      const uniqueNotifyIds = Array.from(allNotifyIds).filter((id) => id && id.trim());

      // Send SPRINT_STARTED notifications to all team members and assigned users
      if (uniqueNotifyIds.length > 0) {
        await createBulkNotifications({
          workspaceId: sprint.workspaceId,
          userIds: uniqueNotifyIds,
          type: 'SPRINT_STARTED',
          data: {
            sprintName: sprint.name,
            sprintGoal: sprint.goal,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            taskCount: tasksUpdated || variables.taskCount || 0,
            sprintId: sprint.id,
          },
        });
      }

      toast({
        title: 'Sprint started',
        description: `The sprint is now active. ${tasksUpdated} task(s) moved to TODO.`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to start sprint',
        variant: 'destructive',
      });
    },
  });
}

export function useCompleteSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sprintId,
      retrospectiveNotes,
    }: {
      sprintId: string;
      projectId: string;
      retrospectiveNotes?: string;
      teamMemberIds?: string[];
      completedTasks?: number;
      totalTasks?: number;
    }) => {
      const response = await resources.update('sprints', sprintId,
        {
          status: 'COMPLETED',
          retrospectiveNotes: retrospectiveNotes || '',
        }
      );
      return response as unknown as Sprint;
    },
    onSuccess: async (
      sprint: Sprint,
      variables: {
        sprintId: string;
        projectId: string;
        retrospectiveNotes?: string;
        teamMemberIds?: string[];
        completedTasks?: number;
        totalTasks?: number;
      }
    ) => {
      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', variables.projectId] });

      // Send SPRINT_COMPLETED notifications to team members
      if (variables.teamMemberIds && variables.teamMemberIds.length > 0) {
        await createBulkNotifications({
          workspaceId: sprint.workspaceId,
          userIds: variables.teamMemberIds,
          type: 'SPRINT_COMPLETED',
          data: {
            sprintName: sprint.name,
            completedTasks: variables.completedTasks || 0,
            totalTasks: variables.totalTasks || 0,
            completionRate: variables.totalTasks
              ? Math.round(((variables.completedTasks || 0) / variables.totalTasks) * 100)
              : 0,
            sprintId: sprint.id,
          },
        });
      }

      toast({
        title: 'Sprint completed',
        description: 'The sprint has been marked as completed.',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to complete sprint',
        variant: 'destructive',
      });
    },
  });
}

