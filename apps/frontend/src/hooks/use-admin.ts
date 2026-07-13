/**
 * Admin user management hooks.
 */

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { restClient } from '@/lib/api/rest-client';
import { toast } from 'sonner';

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
 */
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserParams) => {
      return restClient.post('/api/v1/users/invite/', data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });

      if (result.type === 'new_user') {
        toast.success('User created successfully', {
          description: 'Welcome email sent with temporary password',
        });
      } else {
        toast.success('Invitation sent', {
          description: 'User will receive an email to join this workspace',
        });
      }
    },
    onError: (error: unknown) => {
      toast.error('Failed to create user', {
        description: (error instanceof Error ? error.message : String(error)) || 'Please try again',
      });
    },
  });
}


