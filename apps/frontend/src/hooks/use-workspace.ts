import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import type { Workspace } from '@/types';
import { useMemo } from 'react';
import { useTeamMembers } from './use-team';
import { toast } from 'sonner';

export function useWorkspaces(userId?: string) {
  return useQuery({
    queryKey: ['workspaces', userId],
    queryFn: async () => {
      if (!userId) return [];

      // The API already scopes the list to workspaces the caller can access
      // (owner or member), so one complete listing returns exactly the right set.
      const response = await resources.listAll('workspaces');
      return response.items as unknown as Workspace[];
    },
    enabled: !!userId,
  });
}

export function useWorkspace(workspaceId?: string) {
  return useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return null;

      const response = await resources.get('workspaces', workspaceId
      );

      return response as unknown as Workspace;
    },
    enabled: !!workspaceId,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const { setCurrentWorkspaceId } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      ownerId: string;
      /** Somebody else runs it: they own it and are its first Manager. */
      manager?: { name: string; email: string };
    }) => {
      // Check if user already has a workspace with this name
      const existingWorkspaces = await resources.list('workspaces', [
        query.equal('ownerId', data.ownerId),
        query.equal('name', data.name)
      ]
      );

      if (existingWorkspaces.items.length > 0) {
        throw new Error('You already have a workspace with this name. Please choose a different name.');
      }

      // The server derives ownerId from the session, generates the invite code
      // and creates the owner membership itself; settings must be a native
      // object (the DTO validates @IsObject).
      const workspaceData = {
        name: data.name,
        description: data.description || '',
        // Nothing to declare yet: the four flags that used to be written here
        // (public sign-up, approval, notifications, integrations) were read by
        // nothing, on either side.
        settings: {},
        ...(data.manager ? { manager: data.manager } : {}),
      };

      const response = await resources.create('workspaces',
        workspaceData
      );

      return response as unknown as Workspace & {
        /** Who it was created for; `temporaryPassword` only when mail cannot carry it. */
        manager?: { userId: string; name: string; email: string; emailSent: boolean; temporaryPassword?: string };
      };
    },
    onSuccess: (newWorkspace) => {
      // 1. Seed the new workspace into the cached list BEFORE switching to it.
      //    `invalidateQueries` keeps the old data while it refetches, so for the
      //    duration of that round trip the list still read [A, B] — and
      //    WorkspaceProvider's self-heal effect, seeing the freshly selected
      //    id in no workspace of that list, bounced the selection straight back
      //    to workspaces[0]. Writing the row in first makes the new id resolve
      //    immediately; the refetch below then reconciles.
      queryClient.setQueriesData<Workspace[]>({ queryKey: ['workspaces'] }, (old) =>
        old && !old.some((w) => w.id === newWorkspace.id) ? [...old, newWorkspace] : old,
      );
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });

      // 2. Make the new workspace active through the provider, which both
      //    persists the selection AND updates React state AND drops every
      //    workspace-scoped query (so the new workspace starts empty). Writing
      //    localStorage directly left the UI on the previous workspace until a
      //    full reload.
      setCurrentWorkspaceId(newWorkspace.id);

      toast.success(`Workspace "${newWorkspace.name}" created`);
    },
    onError: (error: Error) => {
      toast.error('Failed to create workspace', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      name?: string;
      description?: string;
      settings?: Workspace['settings'];
    }) => {
      const { workspaceId, ...updates } = data;

      // settings passes through as a native object (the DTO validates @IsObject)
      const updateData: Record<string, unknown> = { ...updates };

      const response = await resources.update('workspaces', workspaceId,
        updateData
      );

      return response as unknown as Workspace;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace updated');
    },
    onError: (error: Error) => {
      toast.error('Failed to update workspace', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  const { noteDeparture } = useWorkspaceContext();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      // The server owns the cascade: DELETE /workspaces/:id runs a
      // transactional child-first deletion (including HR retention archiving),
      // so the client makes exactly one call.
      await resources.remove('workspaces', workspaceId);
    },
    onSuccess: (_result, workspaceId) => {
      // Before the list refetches: losing it is the caller's own doing.
      noteDeparture(workspaceId, 'deleted');
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast.success('Workspace and all associated data deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete workspace', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/** End the caller's own membership of a workspace. */
export function useLeaveWorkspace() {
  const queryClient = useQueryClient();
  const { noteDeparture } = useWorkspaceContext();

  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string; workspaceName: string }) => {
      await restClient.post(`/api/v1/workspaces/${workspaceId}/leave/`, {});
    },
    onSuccess: (_result, variables) => {
      // Said BEFORE the list refetches, so that moving off it reads as the
      // caller's own doing rather than as access a manager took away.
      noteDeparture(variables.workspaceId, 'left');
      // The list (which also moves the app off this workspace if it was the
      // current one), what the caller may do where, and what they can ask to
      // join again.
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['my-access'] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-directory'] });
      toast.success('Left workspace', { description: `You are no longer a member of ${variables.workspaceName}.` });
    },
    onError: (error: Error) => {
      toast.error("Couldn't leave the workspace", { description: (error instanceof Error ? error.message : String(error)) || 'Please try again.' });
    },
  });
}

export function useJoinWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { inviteCode: string }) => {
      // Redeeming a code is a server-side workflow: the workspaces list is
      // scoped to workspaces the caller is ALREADY in and does not accept an
      // `inviteCode` filter, so resolving the workspace client-side either
      // found nothing or matched an unrelated workspace.
      //
      // The server normalises case and stray spaces, and decides.
      return restClient.post('/api/v1/workspaces/accept-invitation/', {
        code: data.inviteCode.trim(),
      }) as Promise<{ success: true; workspaceId: string; role?: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      // ['team-members'] is the key the roster actually registers; the old
      // ['workspace-members'] root no longer exists and matched nothing.
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      // What the caller may DO in the new workspace, and what is left to ask
      // for: both are cached per user and were stale after a join made from
      // inside the app (Workspaces > Join a workspace).
      queryClient.invalidateQueries({ queryKey: ['my-access'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-directory'] });
      toast.success('Workspace Joined', { description: 'You now have access to this workspace. It is in your workspace list.' });
    },
    onError: (error: unknown) => {
      toast.error('Failed to join workspace', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

/**
 * Workspace roster, shaped like a user record.
 *
 * `id` is the USER id, not the membership id: every consumer matches these
 * against task/FR assignee ids. `membershipId` is kept for callers that need to
 * address the membership row itself.
 */
export interface WorkspaceMemberUser {
  id: string;
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  status: string;
}

/**
 * The workspace roster in the shape the assignee pickers want.
 *
 * Projected from `useTeamMembers` rather than fetched again. Both hooks read
 * the SAME `workspace_members` endpoint, but they used to register different
 * cache keys — so React Query could not dedupe them and any screen using both
 * (Analytics did) fetched the roster twice and cached two copies that could
 * drift. One query now, two shapes.
 */
export function useWorkspaceMembers(workspaceId?: string) {
  const teamQuery = useTeamMembers(workspaceId);
  const { data } = teamQuery;

  const members = useMemo<WorkspaceMemberUser[] | undefined>(
    () =>
      data?.map((m) => ({
        id: String(m.userId),
        membershipId: String(m.id),
        userId: String(m.userId),
        // No synthetic 'User a1b2c3d4' label: the API returns the real name, and
        // a fabricated one is indistinguishable from a genuine account.
        name: m.name || m.email || '',
        email: m.email ?? '',
        avatar: m.avatar ?? '',
        // The RAW role, not the display-normalised one: callers compare this
        // against the permission matrix, which is keyed on the stored value.
        role: m.rawRole ?? 'MEMBER',
        status: m.status ?? 'ACTIVE',
      })),
    [data],
  );

  return { ...teamQuery, data: members };
}

/**
 * Hand a workspace to another of its managers. The server checks the new owner
 * is an active member whose role can run it.
 */
export function useTransferOwnership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { workspaceId: string; userId: string; name: string }) =>
      restClient.post(`/api/v1/workspaces/${data.workspaceId}/transfer-ownership/`, {
        userId: data.userId,
      }),
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace', data.workspaceId] });
      toast.success(`${data.name} now owns this workspace`);
    },
    onError: (error: Error) => {
      toast.error("Couldn't hand the workspace over", { description: error instanceof Error ? error.message : String(error) });
    },
  });
}
