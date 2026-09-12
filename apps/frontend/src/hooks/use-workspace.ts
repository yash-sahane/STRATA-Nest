import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { parseJsonObject } from '@/lib/api/json-fields';
import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import type { Workspace } from '@/types';
import { useMemo } from 'react';
import { useTeamMembers } from './use-team';
import { toast } from '@/hooks/use-toast';

export function useWorkspaces(userId?: string) {
  return useQuery({
    queryKey: ['workspaces', userId],
    queryFn: async () => {
      if (!userId) return [];

      // The API already scopes the list to workspaces the caller can access
      // (owner or member), so one complete listing returns exactly the right set.
      const response = await resources.listAll<{
        settings?: unknown;
        memberIds?: unknown;
      }>('workspaces');

      // Parse settings JSON
      const parsedWorkspaces = response.items.map((workspace) => ({
        ...workspace,
        settings: parseJsonObject(workspace.settings),
        memberIds: Array.isArray(workspace.memberIds)
          ? workspace.memberIds
          : [],
      }));

      return parsedWorkspaces as unknown as Workspace[];
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

      // Parse JSON fields
      const workspace = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds)
          ? response.memberIds
          : [],
      };

      return workspace as unknown as Workspace;
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
        settings: {
          allowPublicSignup: false,
          requireApproval: true,
          enableNotifications: true,
          enableIntegrations: false,
        },
      };

      const response = await resources.create('workspaces', 'unique()',
        workspaceData
      );

      // Normalize the response (the API returns settings as a native object)
      const workspace = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds) ? response.memberIds : [response.memberIds],
      };

      return workspace as unknown as Workspace;
    },
    onSuccess: (newWorkspace) => {
      // 1. Seed the new workspace into the cached list BEFORE switching to it.
      //    `invalidateQueries` keeps the old data while it refetches, so for the
      //    duration of that round trip the list still read [A, B] — and
      //    useCurrentWorkspace's self-heal effect, seeing the freshly selected
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

      toast({
        title: 'Success',
        description: `Workspace "${newWorkspace.name}" created successfully!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to create workspace',
        variant: 'destructive',
      });
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
      const updateData: any = { ...updates };

      const response = await resources.update('workspaces', workspaceId,
        updateData
      );

      // Parse the response
      const workspace = {
        ...response,
        settings: parseJsonObject(response.settings),
        memberIds: Array.isArray(response.memberIds)
          ? response.memberIds
          : [],
      };

      return workspace as unknown as Workspace;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast({
        title: 'Success',
        description: 'Workspace updated successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to update workspace',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      // The server owns the cascade: DELETE /workspaces/:id runs a
      // transactional child-first deletion (including HR retention archiving),
      // so the client makes exactly one call.
      await resources.remove('workspaces', workspaceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      toast({
        title: 'Success',
        description: 'Workspace and all associated data deleted successfully!',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to delete workspace',
        variant: 'destructive',
      });
    },
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      name: string;
      email: string;
      role: string;
    }) => {
      // The API owns the whole invitation: it creates the ACTIVE membership at
      // the requested role and mails the workspace's REAL invite code. The old
      // client-side `Math.random()` code matched nothing in the database, so
      // every invitation sent from here was unusable.
      return restClient.post('/api/v1/users/invite/', {
        name: data.name,
        email: data.email,
        roleName: data.role,
        workspaceId: data.workspaceId,
      });
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', variables.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast({
        title: 'Invitation Sent',
        description: `Invitation email sent to ${variables.email}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to send invitation',
        variant: 'destructive',
      });
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
      return restClient.post('/api/v1/workspaces/accept-invitation/', {
        code: data.inviteCode,
      }) as Promise<{ success: true; workspaceId: string; role?: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      // ['team-members'] is the key the roster actually registers; the old
      // ['workspace-members'] root no longer exists and matched nothing.
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast({
        title: 'Workspace Joined',
        description: 'You now have access to this workspace',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to join workspace',
        variant: 'destructive',
      });
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


