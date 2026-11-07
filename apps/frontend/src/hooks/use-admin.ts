/**
 * Admin user management hooks.
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { restClient } from '@/lib/api/rest-client';

interface CreateUserParams {
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  workspaceId: string;
  workspaceName: string;
  createdBy: string;
  createdByName: string;
}

/**
 * What `POST /users/invite` answers with.
 *
 * The same whether the address already had an account or one was created: it
 * used to say which, and so told anybody who could add people whether an
 * address had an account anywhere on the platform.
 *
 * `emailSent` is whether the server can deliver mail at all. When it cannot,
 * a NEW account's `temporaryPassword` is returned here instead — the only copy
 * there will ever be — so the person who created the account can pass it on.
 */
export interface InviteUserResult {
  success: boolean;
  userId: string;
  message: string;
  emailSent?: boolean;
  temporaryPassword?: string;
}

/** One sentence saying what actually happened, for the toast. */
export function describeInviteResult(result: InviteUserResult, email: string): string {
  if (result.temporaryPassword) {
    return 'No email was sent — copy their temporary password before you leave this screen.';
  }
  return result.emailSent
    ? `${email} now has access to this workspace, and has been emailed about it.`
    : `${email} now has access to this workspace. No email was sent, so let them know.`;
}

/**
 * Create new user (admin only)
 * Calls the invitation endpoint directly.
 *
 * Deliberately silent: bulk import drives this mutation once per CSV row, so a
 * toast here would fire N times. The caller owns user-facing messaging.
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserParams) => {
      return (await restClient.post('/api/v1/users/invite/', data)) as InviteUserResult;
    },
    onSuccess: () => {
      // The two roots an invited user actually shows up under. There is no
      // ['users'] query registered anywhere, so invalidating it was a no-op.
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
  });
}


