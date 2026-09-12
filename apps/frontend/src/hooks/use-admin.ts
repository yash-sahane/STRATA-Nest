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
      return restClient.post('/api/v1/users/invite/', data);
    },
    onSuccess: () => {
      // The two roots an invited user actually shows up under. There is no
      // ['users'] query registered anywhere, so invalidating it was a no-op.
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
    },
  });
}


