'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { ApiError, restClient } from '@/lib/api/rest-client';
import type { EditBasedOn, FunctionalRequirement, FunctionalRequirementStatus } from '@/types';
import { showSaveFailure } from '@/lib/api/mutation-error';
import { toast } from 'sonner';

// Fetch all functional requirements for a project
export function useFunctionalRequirements(projectId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      // listAll: the stats, search and status filter all operate on this array,
      // so a silently truncated first page would make every one of them wrong.
      const response = await resources.listAll('functional_requirements', [
        query.equal('projectId', projectId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!projectId,
  });
}

// Fetch single functional requirement
export function useFunctionalRequirement(requirementId?: string) {
  return useQuery({
    queryKey: ['functional-requirement', requirementId],
    queryFn: async () => {
      if (!requirementId) return null;

      const response = await resources.get('functional_requirements', requirementId);

      return response as unknown as FunctionalRequirement;
    },
    enabled: !!requirementId,
  });
}

// ? NEW: Get FRs by Epic (proper hierarchy)
export function useFunctionalRequirementsByEpic(epicId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', 'epic', epicId],
    queryFn: async () => {
      if (!epicId) return [];

      const response = await resources.listAll('functional_requirements', [
        query.equal('epicId', epicId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!epicId,
  });
}

// ? NEW: Get FRs by Sprint
export function useFunctionalRequirementsBySprint(sprintId?: string) {
  return useQuery({
    queryKey: ['functional-requirements', 'sprint', sprintId],
    queryFn: async () => {
      if (!sprintId) return [];

      const response = await resources.listAll('functional_requirements', [
        query.equal('sprintId', sprintId),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as FunctionalRequirement[];
    },
    enabled: !!sprintId,
  });
}

// Create functional requirement
export function useCreateFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      projectId: string;
      projectCode: string;
      epicId?: string; // ? FIXED: Primary parent (epic)
      sprintId?: string; // ? NEW: Optional sprint assignment
      clientRequirementId?: string; // Keep for traceability
      parentRequirementId?: string;
      title: string;
      description?: string;
      type: 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'TECHNICAL' | 'BUSINESS'; // Required type field
      complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; // ? NEW: Priority field
      status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'IMPLEMENTED' | 'TESTED' | 'DEPLOYED';
      assigneeIds?: string[];
    }) => {
      // No id: the server mints it from the project, epic and client
      // requirement — or from the parent, for a child requirement.
      const requirementData = {
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        epicId: data.epicId || '', // ? FIXED: Link to parent epic
        sprintId: data.sprintId || '', // ? NEW: Optional sprint assignment
        clientRequirementId: data.clientRequirementId || '',
        parentRequirementId: data.parentRequirementId || '',
        title: data.title,
        description: data.description || '',
        type: data.type, // Required type field
        complexity: data.complexity,
        priority: data.priority || 'MEDIUM', // ? NEW: Priority with default
        status: data.status,
        // Their names, and who created it, are the server's.
        assigneeIds: data.assigneeIds || [],
      };

      const response = await resources.create('functional_requirements',
        requirementData
      );

      return response as unknown as FunctionalRequirement;
    },
    onSuccess: async (createdFR, variables) => {
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      if (variables.epicId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'epic', variables.epicId],
        });
      }
      if (variables.sprintId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'sprint', variables.sprintId],
        });
      }
      if (variables.clientRequirementId) {
        queryClient.invalidateQueries({
          queryKey: ['client-requirement', variables.clientRequirementId],
        });
      }

      // The people assigned are told by the API as part of the write itself
      // (WorkNotificationSubscriber) — not by this browser afterwards.
      toast.success('Functional requirement created');
    },
    onError: (error: unknown) => {
      toast.error('Failed to create functional requirement', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

// Update functional requirement
export function useUpdateFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      requirementId: string;
      projectId: string;
      updates: EditBasedOn<Partial<FunctionalRequirement>>;
    }) => {
      // One request. Where a requirement goes its tasks go — into the sprint,
      // out of it, under the other epic — and a requirement planned with no
      // tasks becomes one. The API does all of that as part of this save
      // (RequirementTasks), then re-sums the requirement and its epic.
      //
      // It used to be done from here, as a string of further requests after the
      // requirement had already been saved: list the tasks, PATCH each one,
      // create one if there were none, PATCH the totals. A tab closed part-way
      // left a requirement in a sprint with its tasks outside it, every one of
      // those requests ran with the permissions of whoever clicked, and each
      // planning overwrote the tasks' due dates with the sprint's end.
      //
      // `basedOn` addresses the save rather than the record, but it travels in
      // the same object; it goes to the API and nowhere else.
      const response = await resources.update(
        'functional_requirements',
        data.requirementId,
        { ...data.updates } as Record<string, unknown>
      );
      return response as unknown as FunctionalRequirement;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['functional-requirements', variables.projectId] });
      queryClient.invalidateQueries({
        queryKey: ['functional-requirement', variables.requirementId],
      });
      // ['tasks', 'functional-requirement', id] does NOT share a prefix with
      // ['tasks', projectId], so it needs its own invalidation.
      queryClient.invalidateQueries({
        queryKey: ['tasks', 'functional-requirement', variables.requirementId],
      });

      // Prefixes, not ['functional-requirements','epic'|'sprint', result.<id>]:
      // the only ids on the RESULT are the ones the FR moved TO, so the list it
      // moved OUT of was never refreshed — and a clear (sprintId:'') refreshed
      // nothing at all, because '' is falsy. After "Remove from Sprint" the
      // backlog rendered the same FR in "Sprint FRs" (stale) and in "FR Backlog"
      // (fresh) at the same time, in contradictory states.
      //
      // Only epicId and sprintId decide WHICH of those lists an FR belongs to,
      // so only they need the refetch. Every other edit — a sprint-board drag
      // (status), an assignee change from fr-assignment-card — leaves the FR in
      // exactly the lists it was already in and merely changes how its row
      // renders, which the cache can be told directly. Invalidating on those
      // too refetched every epic- and sprint-scoped list in the cache for
      // nothing; simply skipping them would have been worse, because the board
      // and the backlog would then keep rendering the pre-drag status for the
      // whole 60s staleTime.
      if (variables.updates.epicId !== undefined || variables.updates.sprintId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['functional-requirements', 'epic'] });
        queryClient.invalidateQueries({ queryKey: ['functional-requirements', 'sprint'] });
        // Its tasks moved with it on the server, and the epics' totals with them.
        queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
        queryClient.invalidateQueries({ queryKey: ['epics', variables.projectId] });
        queryClient.invalidateQueries({ queryKey: ['epic'] });
      } else {
        // Its open tasks follow a change of people on the server.
        if (variables.updates.assigneeIds !== undefined) {
          queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
        }
        queryClient.setQueriesData<FunctionalRequirement[]>(
          { queryKey: ['functional-requirements'] },
          (rows) =>
            Array.isArray(rows)
              ? rows.map((row) => (row.id === result.id ? { ...row, ...result } : row))
              : rows
        );
      }
      // No success toast here on purpose: every caller already emits its own,
      // more specific one, and a shared hook toast stacked N+3 of them on a
      // single save. Errors are still surfaced below.
    },
    onError: (error: unknown) => {
      showSaveFailure(error, 'Failed to update functional requirement');
    },
  });
}

// Delete functional requirement
export function useDeleteFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { requirementId: string; projectId: string; cascade?: boolean }) => {
      // The server owns the cascade: without the cascade flag it responds 409
      // when child requirements exist; with cascade=true it deletes the
      // descendant requirements and unlinks any tasks (kept).
      await restClient.delete(
        `/api/v1/functional_requirements/${data.requirementId}/`,
        data.cascade ? { params: { cascade: 'true' } } : undefined,
      );
    },
    onSuccess: (_, variables) => {
      // Root prefix, not ['functional-requirements', projectId]: a cascade also
      // removes descendants, and the epic- and sprint-scoped lists
      // (['functional-requirements','epic'|'sprint', id]) do not share that key,
      // so the epic dialog kept rendering FRs that no longer exist.
      queryClient.invalidateQueries({ queryKey: ['functional-requirements'] });
      queryClient.invalidateQueries({ queryKey: ['functional-requirement', variables.requirementId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
      toast.success('Functional requirement deleted');
    },
    onError: (error: unknown) => {
      // Same as the client-requirement delete: 409 means "children block this",
      // which the detail dialog turns into a cascade prompt. Toasting it here
      // leaked the API's `retry with cascade=true` hint as an error.
      if (error instanceof ApiError && error.code === 409) return;
      toast.error('Failed to delete functional requirement', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

// ? NEW: Clone/Reuse functional requirement to another project
export function useCloneFunctionalRequirement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      requirementId: string;
      targetProjectId: string;
      targetProjectCode: string;
      targetEpicId?: string;
      targetClientRequirementId?: string;
    }) => {
      const {
        requirementId,
        targetProjectId,
        targetEpicId,
        targetClientRequirementId,
      } = data;

      // Fetch original FR
      const originalFR = (await resources.get('functional_requirements', requirementId
      )) as unknown as FunctionalRequirement;

      const targetProject = await resources.get('projects', targetProjectId);

      // Create cloned FR with new project/hierarchy, reset sprint assignment
      const clonedFRData = {
        workspaceId: targetProject.workspaceId,
        projectId: targetProjectId,
        title: originalFR.title,
        description: `${originalFR.description}\n\n(Cloned from ${originalFR.hierarchyId})`,
        // Without this the clone fell back to the server default and every copy
        // of a NON_FUNCTIONAL / TECHNICAL / BUSINESS FR came back as FUNCTIONAL.
        type: originalFR.type || 'FUNCTIONAL',
        complexity: originalFR.complexity,
        priority: originalFR.priority,
        status: 'DRAFT' as FunctionalRequirementStatus,
        epicId: targetEpicId || '',
        clientRequirementId: targetClientRequirementId || '',
        sprintId: '',
        assigneeIds: [],
      };

      const response = await resources.create('functional_requirements',
        clonedFRData
      );

      return response as unknown as FunctionalRequirement;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['functional-requirements', variables.targetProjectId],
      });

      if (result.epicId) {
        queryClient.invalidateQueries({
          queryKey: ['functional-requirements', 'epic', result.epicId],
        });
      }

      toast.success('FR Cloned Successfully!', { description: `${result.hierarchyId} created in target project` });
    },
    onError: (error: unknown) => {
      toast.error('Failed to clone functional requirement', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

