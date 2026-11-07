import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources, query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { logger } from '@/lib/logger';
import type { JoinRequest } from '@/types';
import { toast } from 'sonner';

/**
 * Workspace join requests.
 *
 * The API has carried the whole workflow for a while — list, create, and a
 * `JoinRequestApprovalService` that creates the membership in the same
 * transaction as the approval — but nothing on the client ever called
 * approve or reject, so a request could be raised and then never actioned.
 */

/**
 * A row of the queue as the API actually serves it.
 *
 * `alreadyMember` is not on the shared `JoinRequest` type because it is not a
 * stored field: the API computes it per read (`JoinRequestsService.hydrate`)
 * from whether the requester now holds an ACTIVE membership. It is what lets
 * the queue tell the manager that a request has been overtaken — the person
 * got in by another door — rather than offering a decision that no longer
 * means anything.
 */
export interface JoinRequestRow extends JoinRequest {
  alreadyMember?: boolean;
  /**
   * The role they held here before their access was switched off; null for
   * anybody who was never a member. Approving with nothing chosen brings them
   * back at it — offering Member demoted a returning manager without a word.
   */
  previousRole?: string | null;
}

/** Pending requests for a workspace. Requires `join:manage` to return rows. */
export function useJoinRequests(workspaceId?: string, status: string = 'PENDING') {
  return useQuery({
    queryKey: ['join-requests', workspaceId, status],
    queryFn: async () => {
      if (!workspaceId) return [] as JoinRequestRow[];
      const response = await resources.listAll<JoinRequestRow>('join_requests', [
        query.equal('workspaceId', workspaceId),
        query.orderDesc('createdAt'),
      ]);
      const rows = response.items as JoinRequestRow[];
      return status ? rows.filter((r) => r.status === status) : rows;
    },
    enabled: !!workspaceId,
  });
}

/** `role` is what the requester joins at; only an approval carries one. */
interface JoinRequestDecision {
  requestId: string;
  role?: string;
}

function useJoinRequestDecision(action: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  const verb = action === 'approve' ? 'approved' : 'rejected';

  return useMutation({
    mutationFn: async ({ requestId, role }: JoinRequestDecision) => {
      // The server owns the transition: approving also creates the membership,
      // and both endpoints refuse a request that is no longer PENDING.
      return restClient.post(
        `/api/v1/join_requests/${requestId}/${action}/`,
        action === 'approve' && role ? { role } : {},
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['join-requests'] });
      // Approval mints a membership, so the team list and member counts move too.
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success(`Request ${verb}`, { description: action === 'approve'
            ? 'They now have access to this workspace.'
            : 'The request was declined.' });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to ${action} join request`, { error });
      toast.error(`Couldn't ${action} the request`, { description: message || 'Please try again.' });
      // Most often somebody else decided it first ("already been decided"): the
      // row on screen is stale, and only a fresh read shows what happened.
      queryClient.invalidateQueries({ queryKey: ['join-requests'] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
  });
}

export function useApproveJoinRequest() {
  return useJoinRequestDecision('approve');
}

export function useRejectJoinRequest() {
  return useJoinRequestDecision('reject');
}

/** One row of the request-access picker. */
export interface DirectoryWorkspace {
  id: string;
  name: string;
  /** The caller already has a PENDING request here. */
  requested: boolean;
  /** The caller was a member and a manager switched their access off. */
  accessSwitchedOff?: boolean;
  /** When the caller's last request here was declined. */
  declinedAt?: string;
}

export const WORKSPACE_DIRECTORY_KEY = ['workspace-directory'] as const;

/** Every workspace the caller is not active in — see useWorkspaceDirectory. */
export async function fetchWorkspaceDirectory(): Promise<DirectoryWorkspace[]> {
  return (await restClient.get('/api/v1/workspaces/directory/')) as DirectoryWorkspace[];
}

/**
 * Workspaces the caller could ask to join.
 *
 * `useWorkspaces` only returns workspaces you are already in, so before this
 * existed a would-be requester had no way to name one — `POST /join_requests`
 * needs a workspaceId and none was discoverable.
 */
export function useWorkspaceDirectory(enabled = true) {
  return useQuery({
    queryKey: WORKSPACE_DIRECTORY_KEY,
    queryFn: fetchWorkspaceDirectory,
    enabled,
    staleTime: 60 * 1000,
  });
}

export function useCreateJoinRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { workspaceId: string; message?: string }) =>
      restClient.post('/api/v1/join_requests/', {
        workspaceId: data.workspaceId,
        message: data.message ?? '',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-directory'] });
      queryClient.invalidateQueries({ queryKey: ['join-requests'] });
      toast.success('Request sent', { description: "A workspace manager will review it. You'll get access once they approve." });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create join request', { error });
      toast.error("Couldn't send the request", { description: message || 'Please try again.' });
    },
  });
}
