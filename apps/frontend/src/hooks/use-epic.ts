import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { EditBasedOn, Epic, Task } from '@/types';
import { toast } from '@/hooks/use-toast';
import { saveFailureToast } from '@/lib/api/mutation-error';
import { createBulkNotifications } from '@/hooks/use-notification';
import { logger } from '@/lib/logger';

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
export function deriveEpicMetrics(tasks: Pick<Task, 'status'>[]) {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
  const status: Epic['status'] =
    totalTasks > 0 && completedTasks === totalTasks
      ? 'DONE'
      : completedTasks > 0
        ? 'IN_PROGRESS'
        : 'TODO';

  return {
    totalTasks,
    completedTasks,
    progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    status,
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

export function useEpic(epicId?: string) {
  return useQuery({
    queryKey: ['epic', epicId],
    queryFn: async () => {
      if (!epicId) return null;

      const response = await resources.get('epics', epicId);

      return response as unknown as Epic;
    },
    enabled: !!epicId,
  });
}

// ? NEW: Get epics by requirement (proper hierarchy)
export function useEpicsByRequirement(requirementId?: string) {
  return useQuery({
    queryKey: ['epics', 'requirement', requirementId],
    queryFn: async () => {
      if (!requirementId) return [];

      const response = await resources.listAll('epics', [
        query.equal('requirementId', requirementId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as Epic[];
    },
    enabled: !!requirementId,
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
      assignedTeam?: string; // ? NEW: Team assignment
      createdBy: string;
      createdByName?: string;
    }) => {
      // DEFENSIVE: Validate workspaceId is provided
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      // Get existing epics to generate hierarchyId (listAll: a truncated first
      // page would freeze the counter and re-issue ids that already exist).
      const existingEpics = await resources.listAll<{ hierarchyId?: string | null }>('epics', [
        query.equal('projectId', data.projectId),
      ]);

      // Generate hierarchical id (e.g., ABC-EPIC-01, ABC-EPIC-02). Advance past
      // the HIGHEST existing number rather than counting rows — deleting an epic
      // must not make the next create re-use a live id.
      const highest = existingEpics.items.reduce((max: number, e) => {
        const n = Number.parseInt(/-EPIC-(\d+)$/.exec(String(e.hierarchyId ?? ''))?.[1] ?? '', 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      const epicNumber = (Math.max(existingEpics.items.length, highest) + 1)
        .toString()
        .padStart(2, '0');
      const hierarchyId = `${data.projectCode}-EPIC-${epicNumber}`;

      const epicData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        hierarchyId,
        name: data.name,
        description: data.description || '',
        color: data.color,
        startDate: data.startDate,
        endDate: data.endDate,
        status: 'TODO',
        progress: 0,
        requirementId: data.requirementId || '', // ? FIXED: Link to parent requirement
        assignedTeam: data.assignedTeam || '', // ? NEW: Team assignment
        createdBy: data.createdBy,
        createdByName: data.createdByName || '',
      };

      const response = await resources.create('epics', id.unique(),
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

      // ? Send EPIC_CREATED notification to workspace members
      try {
        // Get project name for notification
        let projectName = 'Project';
        try {
          const project = await resources.get('projects', variables.projectId
          );
          projectName = project.name || 'Project';
        } catch (error) {
          logger.error('Failed to get project name for notification', { error });
        }

        // Get workspace members to notify
        const membersResponse = await resources.listAll('workspace_members', [query.equal('workspaceId', variables.workspaceId)]
        );

        const memberIds = membersResponse.items
          .map((m: any) => m.userId)
          .filter((id: string) => id !== variables.createdBy); // Don't notify creator

        if (memberIds.length > 0) {
          await createBulkNotifications({
            workspaceId: variables.workspaceId,
            userIds: memberIds,
            type: 'EPIC_CREATED',
            data: {
              epicId: createdEpic.id,
              epicTitle: createdEpic.name,
              epicHierarchyId: createdEpic.hierarchyId,
              projectId: variables.projectId,
              projectName,
              creatorName: variables.createdByName || 'Team Member',
              entityType: 'EPIC',
            },
          });
        }
      } catch (error) {
        logger.error('Failed to send epic creation notifications', { error });
      }

      toast({
        title: 'Success',
        description: 'Epic created successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to create epic',
        variant: 'destructive',
      });
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
        status?: Epic['status'];
        progress?: number;
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
      toast({
        title: 'Success',
        description: 'Epic updated successfully!',
      });
    },
    onError: (error: Error) => {
      toast(saveFailureToast(error, 'Failed to update epic'));
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
      toast({
        title: 'Success',
        description: 'Epic deleted. Linked tasks and requirements were kept.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to delete epic',
        variant: 'destructive',
      });
    },
  });
}

