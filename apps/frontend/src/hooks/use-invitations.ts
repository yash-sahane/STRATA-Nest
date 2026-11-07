import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { restClient } from '@/lib/api/rest-client';

/** An invitation to a workspace, addressed to the signed-in person. */
export interface WorkspaceInvitation {
  /** The membership id: accepting or declining is addressed to it. */
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
  invitedAt: string;
  /** Who sent it; '' when that is no longer on record. */
  invitedByName: string;
}

export type InvitationAnswer = 'accept' | 'decline';

/**
 * The invitations waiting on the signed-in person.
 *
 * Adding somebody to a workspace is an invitation now: it grants nothing until
 * they accept it. The list lives outside every workspace — the person is not in
 * them yet — so it is asked of the server on its own, and asked again when the
 * window comes back into focus (somebody may have been invited meanwhile).
 */
export function useMyInvitations(options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['workspace-invitations'],
    queryFn: async () =>
      (await restClient.get('/api/v1/workspace_members/invitations/')) as WorkspaceInvitation[],
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: options.poll ? 30_000 : false,
  });
}

/** Accept or decline one invitation. */
export function useAnswerInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      invitation,
      answer,
    }: {
      invitation: WorkspaceInvitation;
      answer: InvitationAnswer;
    }) => {
      await restClient.post(`/api/v1/workspace_members/${invitation.id}/${answer}/`, {});
    },
    onSuccess: (_result, { invitation, answer }) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] });
      if (answer === 'accept') {
        // A workspace more: the list, what the person may do in it, and the
        // directory that offered "ask to join" for it.
        queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        queryClient.invalidateQueries({ queryKey: ['my-access'] });
        queryClient.invalidateQueries({ queryKey: ['workspace-directory'] });
        toast.success(`You joined ${invitation.workspaceName}`);
      } else {
        toast.success('Invitation declined', {
          description: `You are not a member of ${invitation.workspaceName}.`,
        });
      }
    },
    onError: (error: Error) => {
      // Withdrawn meanwhile, most likely: the list is out of date either way.
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations'] });
      toast.error("Couldn't answer the invitation", {
        description: (error instanceof Error ? error.message : String(error)) || 'Please try again.',
      });
    },
  });
}
