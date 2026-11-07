import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import type { EditBasedOn, Epic, Task } from '@/types';
import { showSaveFailure } from '@/lib/api/mutation-error';
import { toast } from 'sonner';

/**
 * The one definition of an epic's rollup.
 *
 * Epic status and progress are labelled "(Auto-calculated from tasks)" wherever
 * they are shown and no screen lets a human set them, so the stored columns are
 * only a cache — and a lossy one: the delete-last-task path in use-task.ts
 * writes progress=0 but deliberately leaves `status` alone, which stranded
 * epics whose card read "Done - 0% - Tasks 0 / 0" above a detail dialog that
 * said "Todo". Derive both from the task set on every surface so the card, the
 * stat tiles and the dialog cannot disagree.
 *
 * Status is COUNT equality (`completed === total`), never `progress === 100`:
 * Math.round reports 100% at 999 of 1000 done, and a writer using the rounded
 * number would store DONE for an epic this function then renders as In
 * Progress. EpicsService.deriveRollup on the API applies the identical rule,
 * and re-derives status itself on any rollup PATCH that carries a progress, so
 * a stale client cannot reintroduce the contradiction.
 *
 * Every client-side writer of the epic rollup now goes through this function —
 * updateParentProgress in use-task.ts and recalculateParentRollups in
 * use-functional-requirement.ts. Do not hand-roll the arithmetic again.
 */
export function deriveEpicMetrics(epic: Pick<Epic, 'status' | 'progress'>, tasks: Pick<Task, 'status'>[]) {
  // Status and progress are the server's roll-up (rollups.ts in
  // packages/prisma), kept current as work under the epic changes, and counting
  // a requirement that has no task yet as open work. Every screen used to work
  // out its own from the tasks it had loaded, and none of them counted that.
  return {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((t) => t.status === 'DONE').length,
    progress: epic.progress ?? 0,
    status: (epic.status ?? 'TODO') as Epic['status'],
  };
}

export function useEpics(projectId?: string) {
  return useQuery({
    queryKey: ['epics', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // listAll, not list: a single page stops at the server default of 100.
      const response = await resources.listAll('epics', [
        query.equal('projectId', projectId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as Epic[];
    },
    enabled: !!projectId,
  });
}

export function useCreateEpic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      projectCode: string;
      requirementId?: string; // ? FIXED: Use requirementId (parent requirement)
      name: string;
      description?: string;
      color?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      // DEFENSIVE: Validate workspaceId is provided
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      // No id: the server mints the next ECOM-EPIC-NN.
      const epicData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        name: data.name,
        description: data.description || '',
        color: data.color,
        startDate: data.startDate,
        endDate: data.endDate,
        requirementId: data.requirementId || '',
      };

      const response = await resources.create('epics',
        epicData
      );

      return response as unknown as Epic;
    },
    onSuccess: async (createdEpic, variables) => {
      queryClient.invalidateQueries({ queryKey: ['epics', variables.projectId] });
      if (variables.requirementId) {
        queryClient.invalidateQueries({
          queryKey: ['epics', 'requirement', variables.requirementId],
        });
      }

      // The workspace is told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
      toast.success('Epic created');
    },
    onError: (error: Error) => {
      toast.error('Failed to create epic', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

export function useUpdateEpic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      epicId: string;
      projectId: string;
      updates: EditBasedOn<{
        name?: string;
        description?: string;
        color?: string;
        startDate?: string;
        endDate?: string;
        requirementId?: string; // ? FIXED: Use requirementId
        assignedTeam?: string; // ? NEW: Team assignment
      }>;
    }) => {
      const { epicId, ...updates } = data;

      const response = await resources.update('epics', epicId,
        updates.updates
      );

      return response as unknown as Epic;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['epic', variables.epicId] });
      queryClient.invalidateQueries({ queryKey: ['epics', variables.projectId] });
      if (variables.updates.requirementId) {
        queryClient.invalidateQueries({
          queryKey: ['epics', 'requirement', variables.updates.requirementId],
        });
      }
      // Moved to another client requirement (or off one): the server takes the
      // epic's functional requirements along and re-derives both client
      // requirements' status, so the requirement lists and counts change too.
      if (variables.updates.requirementId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
        queryClient.invalidateQueries({ queryKey: ['client-requirements', variables.projectId] });
        queryClient.invalidateQueries({ queryKey: ['client-requirement'] });
      }
      toast.success('Epic updated');
    },
    onError: (error: Error) => {
      showSaveFailure(error, 'Failed to update epic');
    },
  });
}

export function useDeleteEpic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { epicId: string; projectId: string }) => {
      // The server unlinks linked tasks and functional requirements
      // (epicId -> null) and deletes only the epic itself.
      await resources.remove('epics', data.epicId);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['epics', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
      toast.success('Epic deleted', { description: 'Its tasks and requirements were kept.' });
    },
    onError: (error: Error) => {
      toast.error('Failed to delete epic', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

