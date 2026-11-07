import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type { EditBasedOn, Sprint } from '@/types';
import { showSaveFailure } from '@/lib/api/mutation-error';
import { toast } from 'sonner';

export function useSprints(projectId?: string) {
  return useQuery({
    queryKey: ['sprints', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // listAll, not list: a single page stops at the server default of 100.
      const response = await resources.listAll('sprints', [
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

      const response = await resources.listAll('sprints', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as Sprint[];
    },
    enabled: !!workspaceId,
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
      const response = await resources.create('sprints',
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
      toast.success('Sprint created', { description: 'The sprint has been created successfully.' });
    },
    onError: (error: unknown) => {
      toast.error('Failed to create sprint', { description: error instanceof Error ? error.message : String(error) });
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
      updates: EditBasedOn<
        Partial<
          Omit<
            Sprint,
            'id' | 'createdAt' | 'updatedAt' | 'workspaceId' | 'projectId' | 'createdBy'
          >
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
      toast.success('Sprint updated', { description: 'The sprint has been updated successfully.' });
    },
    onError: (error: unknown) => {
      showSaveFailure(error, 'Failed to update sprint');
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
      toast.success('Sprint deleted', { description: 'The sprint has been deleted successfully.' });
    },
    onError: (error: unknown) => {
      toast.error('Failed to delete sprint', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

export function useStartSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    // One request. Starting a sprint also moves its planned tasks from Backlog
    // to To Do and tells the team — both used to be done from here, task by task
    // and person by person, so a tab closed part-way left a started sprint with
    // its work still parked. The API does both as part of the start now.
    mutationFn: async ({ sprintId }: { sprintId: string; projectId: string }) =>
      (await resources.update('sprints', sprintId, { status: 'ACTIVE' })) as unknown as Sprint,
    onSuccess: (_sprint, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', variables.projectId] });
      // The sprint's tasks just moved to To Do on the server.
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });

      toast.success('Sprint started', { description: 'The sprint is now active and its planned tasks are in To Do.' });
    },
    onError: (error: unknown) => {
      toast.error('Failed to start sprint', { description: error instanceof Error ? error.message : String(error) });
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
    }) => {
      // POST /sprints/:id/complete is the transactional path: it guards against
      // completing twice, seeds the retrospective and emits SprintCompleted —
      // which is what rolls unfinished tasks out of the sprint. A plain PATCH
      // of `status` skips all three.
      const response = await restClient.post(`/api/v1/sprints/${sprintId}/complete/`, {});

      // Only write notes when the caller actually supplied them. Coercing an
      // absent value to '' would erase the sprint's existing retrospective notes.
      if (typeof retrospectiveNotes === 'string' && retrospectiveNotes.trim()) {
        const withNotes = await resources.update('sprints', sprintId, { retrospectiveNotes });
        return withNotes as unknown as Sprint;
      }
      return response as unknown as Sprint;
    },
    onSuccess: async (
      sprint: Sprint,
      variables: {
        sprintId: string;
        projectId: string;
        retrospectiveNotes?: string;
      }
    ) => {
      queryClient.invalidateQueries({ queryKey: ['sprint', variables.sprintId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['sprint', 'active', variables.projectId] });
      // Completion rolls unfinished tasks out of the sprint server-side — and
      // the requirements they belong to, which go back to the FR backlog.
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirements'] });

      // What the server recorded as it closed the sprint, not a client count.
      const done = sprint.completedTaskCount ?? 0;
      const total = sprint.totalTaskCount ?? 0;
      const rolled = sprint.rolledOverTaskCount ?? 0;
      toast.success('Sprint completed', { description: rolled > 0
            ? `${done} of ${total} tasks done. ${rolled} unfinished ${rolled === 1 ? 'task' : 'tasks'} left the sprint with ${rolled === 1 ? 'its requirement' : 'their requirements'}, to be planned again.`
            : `${done} of ${total} tasks done.` });
    },
    onError: (error: unknown) => {
      toast.error('Failed to complete sprint', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

