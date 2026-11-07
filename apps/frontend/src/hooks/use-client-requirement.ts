import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { ApiError, restClient } from '@/lib/api/rest-client';
import type {
  ClientRequirement,
  RequirementPriority,
  RequirementStatus,
  EditBasedOn,
} from '@/types';
import { showSaveFailure } from '@/lib/api/mutation-error';
import { toast } from 'sonner';

export function useClientRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['client-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const response = await resources.listAll('client_requirements', [query.equal('projectId', projectId), query.orderDesc('createdAt')]
      );
      return response.items as unknown as ClientRequirement[];
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
      return response as unknown as ClientRequirement;
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
        createdBy: data.createdBy,
        createdByName: data.createdByName || '',
      };

      const response = await resources.create('client_requirements',
        requirementData
      );

      return response as unknown as ClientRequirement;
    },
    onSuccess: async (createdReq, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-requirements', variables.projectId] });

      // The workspace is told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
      toast.success('Client requirement created');
    },
    onError: (error: Error) => {
      toast.error('Failed to create client requirement', { description: error instanceof Error ? error.message : String(error) });
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
      toast.success('Client requirement updated');
    },
    onError: (error: Error) => {
      showSaveFailure(error, 'Failed to update client requirement');
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
      toast.success('Client requirement deleted');
    },
    onError: (error: Error) => {
      // A 409 is a DESIGNED step of this flow, not a failure: the dialog
      // catches it and offers the cascade. react-query runs onError before the
      // caller's catch, so without this the user saw a red toast carrying the
      // server's raw "retry with cascade=true" developer instruction at the
      // same moment the polished prompt (with that sentence stripped) rendered.
      if (error instanceof ApiError && error.code === 409) return;
      toast.error('Failed to delete client requirement', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

