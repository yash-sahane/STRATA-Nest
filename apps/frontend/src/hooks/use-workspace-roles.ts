import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { query, resources } from '@/lib/api/client';
import { toast } from 'sonner';

/** A workspace's own role: a name, and the API permission keys it carries. */
export interface CustomRole {
  id: string;
  workspaceId: string;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The custom roles a workspace has defined. Readable by every member — it is
 * how anybody finds out what their own role allows.
 *
 * Deliberately free of `use-permissions`: that module asks this one what a
 * custom role carries before it can say who may grant it.
 */
export function useWorkspaceRoles(workspaceId?: string) {
  return useQuery({
    queryKey: ['workspace-roles', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<CustomRole[]> => {
      if (!workspaceId) return [];
      const response = await resources.listAll<CustomRole>('workspace_roles', [
        query.equal('workspaceId', workspaceId),
        query.orderAsc('name'),
      ]);
      return response.items.map((role) => ({
        ...role,
        permissions: Array.isArray(role.permissions) ? role.permissions : [],
      }));
    },
    // Role definitions change when somebody edits them here, which invalidates
    // this; otherwise rarely. Every role picker asks, so do not refetch per mount.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Everything a changed role definition is read through: the list itself, the
 * caller's own resolved permissions (their role may be the one that changed),
 * and the roster and invite codes, which follow a rename by name.
 */
function invalidateRoles(queryClient: QueryClient, workspaceId: string): void {
  queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
  queryClient.invalidateQueries({ queryKey: ['my-access'] });
  queryClient.invalidateQueries({ queryKey: ['team-members', workspaceId] });
  queryClient.invalidateQueries({ queryKey: ['invite-codes', workspaceId] });
}

const reasonOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Please try again.';

export function useCreateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { workspaceId: string; name: string; permissions: string[] }) =>
      (await resources.create('workspace_roles', data)) as unknown as CustomRole,
    onSuccess: (role, variables) => {
      invalidateRoles(queryClient, variables.workspaceId);
      toast.success('Role created', { description: `"${role.name}" can now be given to members.` });
    },
    onError: (error: unknown) => {
      toast.error("Couldn't create the role", { description: reasonOf(error) });
    },
  });
}

export function useUpdateWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      roleId,
      ...changes
    }: {
      roleId: string;
      workspaceId: string;
      name?: string;
      permissions?: string[];
    }) => {
      const { workspaceId: _workspaceId, ...body } = changes;
      void _workspaceId;
      return (await resources.update('workspace_roles', roleId, body)) as unknown as CustomRole;
    },
    onSuccess: (_role, variables) => {
      invalidateRoles(queryClient, variables.workspaceId);
      toast.success('Role updated');
    },
    onError: (error: unknown) => {
      toast.error("Couldn't update the role", { description: reasonOf(error) });
    },
  });
}

export function useDeleteWorkspaceRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ roleId }: { roleId: string; workspaceId: string }) => {
      await resources.remove('workspace_roles', roleId);
    },
    onSuccess: (_result, variables) => {
      invalidateRoles(queryClient, variables.workspaceId);
      toast.success('Role deleted');
    },
    onError: (error: unknown) => {
      toast.error("Couldn't delete the role", { description: reasonOf(error) });
    },
  });
}
