import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { Epic } from '@/types';
import { toast } from '@/hooks/use-toast';
import { createBulkNotifications } from '@/hooks/use-notification';
import { logger } from '@/lib/logger';

export function useEpics(projectId?: string) {
  return useQuery({
    queryKey: ['epics', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.list('epics', [
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

      const response = await resources.list('epics', [
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

      // Get existing epics to generate hierarchyId
      const existingEpics = await resources.list('epics', [
        query.equal('projectId', data.projectId),
      ]);

      // Generate hierarchical id (e.g., ABC-EPIC-01, ABC-EPIC-02)
      const epicNumber = (existingEpics.items.length + 1).toString().padStart(2, '0');
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
        const membersResponse = await resources.list('workspace_members', [query.equal('workspaceId', variables.workspaceId)]
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
      updates: {
        name?: string;
        description?: string;
        color?: string;
        startDate?: string;
        endDate?: string;
        status?: Epic['status'];
        progress?: number;
        requirementId?: string; // ? FIXED: Use requirementId
        assignedTeam?: string; // ? NEW: Team assignment
      };
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
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to update epic',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteEpic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { epicId: string; projectId: string }) => {
      // ? CASCADE DELETE: Delete all FRs linked to this epic
      const linkedFRs = await resources.list('functional_requirements', [
        query.equal('epicId', data.epicId),
        query.limit(100),
      ]);

      // For each FR, delete all linked tasks first
      for (const fr of linkedFRs.items) {
        const linkedTasks = await resources.list('tasks', [
          query.equal('functionalRequirementId', fr.id),
          query.limit(100),
        ]);

        // Delete all tasks linked to this FR
        await Promise.all(
          linkedTasks.items.map((task) =>
            resources.remove('tasks', task.id)
          )
        );

        // Delete the FR
        await resources.remove('functional_requirements', fr.id);
      }

      // ? Also delete any tasks directly linked to this epic (without FR)
      const directTasks = await resources.list('tasks', [
        query.equal('epicId', data.epicId),
        query.limit(100),
      ]);

      await Promise.all(
        directTasks.items.map((task) =>
          resources.remove('tasks', task.id)
        )
      );

      // Finally, delete the epic
      await resources.remove('epics', data.epicId);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['epics', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
      toast({
        title: 'Success',
        description: 'Epic and all linked items deleted successfully!',
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

