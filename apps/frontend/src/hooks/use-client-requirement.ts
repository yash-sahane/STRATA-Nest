import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import { ApiError, restClient } from '@/lib/api/rest-client';
import type {
  ClientRequirement,
  RequirementPriority,
  RequirementStatus,
  EditBasedOn,
} from '@/types';
import { toast } from '@/hooks/use-toast';
import { createBulkNotifications } from '@/hooks/use-notification';
import { logger } from '@/lib/logger';
import { saveFailureToast } from '@/lib/api/mutation-error';

export function useClientRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['client-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.listAll('client_requirements', [query.equal('projectId', projectId), query.orderDesc('createdAt')]
      );

      // Normalize attachments: the API returns a native array, but a legacy row
      // could still hold anything. Never JSON.parse inside a queryFn — one bad
      // row would fail the whole list query with no way to recover.
      const requirements = response.items.map((doc) => ({
        ...doc,
        attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
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
        attachments: Array.isArray(response.attachments) ? response.attachments : [],
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
        attachments: [],
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
        // listAll: every member is notified, so a 100-row first page would
        // silently skip the rest of a larger workspace.
        const membersResponse = await resources.listAll('workspace_members', [query.equal('workspaceId', variables.workspaceId)]
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
      updates: EditBasedOn<{
        title?: string;
        description?: string;
        clientName?: string;
        priority?: RequirementPriority;
        status?: RequirementStatus;
      }>;
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
      toast(saveFailureToast(error, 'Failed to update client requirement'));
    },
  });
}

export function useDeleteClientRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requirementId: string; projectId: string; cascade?: boolean }) => {
      // The server owns the cascade: without the cascade flag it responds 409
      // when dependent requirements exist; with cascade=true it deletes the
      // descendant functional requirements and unlinks any tasks (kept).
      await restClient.delete(
        `/api/v1/client_requirements/${data.requirementId}/`,
        data.cascade ? { params: { cascade: 'true' } } : undefined,
      );
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client-requirements', data.projectId] });
      queryClient.invalidateQueries({ queryKey: ['client-requirement', data.requirementId] });
      queryClient.invalidateQueries({ queryKey: ['epics', data.projectId] });
      // Root prefix: a cascade deletes linked FRs anywhere in the project, and
      // the epic-/sprint-scoped FR lists do not share ['...', projectId].
      queryClient.invalidateQueries({ queryKey: ['functional-requirements'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', data.projectId] });
      toast({
        title: 'Success',
        description: 'Client requirement deleted successfully!',
      });
    },
    onError: (error: Error) => {
      // A 409 is a DESIGNED step of this flow, not a failure: the dialog
      // catches it and offers the cascade. react-query runs onError before the
      // caller's catch, so without this the user saw a red toast carrying the
      // server's raw "retry with cascade=true" developer instruction at the
      // same moment the polished prompt (with that sentence stripped) rendered.
      if (error instanceof ApiError && error.code === 409) return;
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

