import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { ClientRequirement, RequirementPriority, RequirementStatus } from '@/types';
import { toast } from '@/hooks/use-toast';
import { createBulkNotifications } from '@/hooks/use-notification';
import { logger } from '@/lib/logger';

export function useClientRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['client-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.list('client_requirements', [query.equal('projectId', projectId), query.orderDesc('createdAt')]
      );

      // Parse attachments from JSON string
      const requirements = response.items.map((doc) => ({
        ...doc,
        attachments:
          typeof doc.attachments === 'string' ? JSON.parse(doc.attachments) : doc.attachments || [],
      })) as unknown as ClientRequirement[];

      return requirements;
    },
    enabled: !!projectId,
  });
}

export function useClientRequirement(requirementId?: string) {
  return useQuery({
    queryKey: ['client-requirement', requirementId],
    queryFn: async () => {
      if (!requirementId) return null;

      const response = await resources.get('client_requirements', requirementId
      );

      const requirement = {
        ...response,
        attachments:
          typeof response.attachments === 'string'
            ? JSON.parse(response.attachments)
            : response.attachments || [],
      } as unknown as ClientRequirement;

      return requirement;
    },
    enabled: !!requirementId,
  });
}

export function useCreateClientRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      title: string;
      description: string;
      clientName: string;
      priority: RequirementPriority;
      createdBy: string;
      createdByName?: string;
    }) => {
      const requirementData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        clientName: data.clientName,
        priority: data.priority,
        status: 'DRAFT' as RequirementStatus,
        attachments: JSON.stringify([]),
        createdBy: data.createdBy,
        createdByName: data.createdByName || '',
      };

      const response = await resources.create('client_requirements', id.unique(),
        requirementData
      );

      return response as unknown as ClientRequirement;
    },
    onSuccess: async (createdReq, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-requirements', variables.projectId] });

      // ? Send REQUIREMENT_CREATED notification to workspace members
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
            type: 'REQUIREMENT_CREATED',
            data: {
              requirementId: createdReq.id,
              requirementTitle: createdReq.title,
              projectId: variables.projectId,
              projectName,
              creatorName: variables.createdByName || 'Team Member',
              clientName: variables.clientName,
              entityType: 'REQUIREMENT',
            },
          });
        }
      } catch (error) {
        logger.error('Failed to send requirement creation notifications', { error });
      }

      toast({
        title: 'Success',
        description: 'Client requirement created successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to create client requirement',
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateClientRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      requirementId: string;
      projectId: string;
      updates: {
        title?: string;
        description?: string;
        clientName?: string;
        priority?: RequirementPriority;
        status?: RequirementStatus;
      };
    }) => {
      const { requirementId, ...updates } = data;

      const response = await resources.update('client_requirements', requirementId,
        updates.updates
      );

      return response as unknown as ClientRequirement;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-requirement', variables.requirementId] });
      queryClient.invalidateQueries({ queryKey: ['client-requirements', variables.projectId] });
      toast({
        title: 'Success',
        description: 'Client requirement updated successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to update client requirement',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteClientRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requirementId: string; projectId: string }) => {
      // ? CASCADE DELETE: Delete all Epics linked to this client requirement
      const linkedEpics = await resources.list('epics', [
        query.equal('requirementId', data.requirementId),
        query.limit(100),
      ]);

      // For each Epic, delete all linked FRs and their tasks
      for (const epic of linkedEpics.items) {
        // Get all FRs linked to this epic
        const linkedFRs = await resources.list('functional_requirements', [
          query.equal('epicId', epic.id),
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

        // Delete any tasks directly linked to this epic
        const epicTasks = await resources.list('tasks', [
          query.equal('epicId', epic.id),
          query.limit(100),
        ]);

        await Promise.all(
          epicTasks.items.map((task) =>
            resources.remove('tasks', task.id)
          )
        );

        // Delete the epic
        await resources.remove('epics', epic.id);
      }

      // ? Also delete FRs directly linked to this client requirement (without Epic)
      const directFRs = await resources.list('functional_requirements', [
        query.equal('clientRequirementId', data.requirementId),
        query.limit(100),
      ]);

      for (const fr of directFRs.items) {
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

      // Finally, delete the client requirement
      await resources.remove('client_requirements', data.requirementId
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client-requirements', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['epics', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
      toast({
        title: 'Success',
        description: 'Client requirement and all linked items deleted successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to delete client requirement',
        variant: 'destructive',
      });
    },
  });
}

