import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import type { Workspace } from '@/types';
import { toast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

export function useWorkspaces(userId?: string) {
  return useQuery({
    queryKey: ['workspaces', userId],
    queryFn: async () => {
      if (!userId) return [];

      // query workspaces where user is owner
      const response = await resources.list('workspaces', [query.equal('ownerId', userId)]
      );

      // Also query all workspaces and filter by memberIds in client
      // memberIds is stored as an array on the workspace resource.
      const allWorkspacesResponse = await resources.list('workspaces', [query.limit(100)]
      );

      // Filter workspaces where user is a member
      const memberWorkspaces = allWorkspacesResponse.items.filter((workspace: any) => {
        const memberIds = Array.isArray(workspace.memberIds)
          ? workspace.memberIds
          : [];
        return memberIds.includes(userId);
      });

      // Combine and deduplicate
      const allWorkspaces = [...response.items, ...memberWorkspaces];
      const uniqueWorkspaces = allWorkspaces.filter((workspace, index, self) =>
        index === self.findIndex((w: any) => w.id === workspace.id)
      );

      // Parse settings JSON
      const parsedWorkspaces = uniqueWorkspaces.map((workspace: any) => ({
        ...workspace,
        settings: typeof workspace.settings === 'string'
          ? JSON.parse(workspace.settings)
          : workspace.settings,
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
        settings: typeof response.settings === 'string'
          ? JSON.parse(response.settings)
          : response.settings,
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

      const workspaceData = {
        name: data.name,
        description: data.description || '',
        ownerId: data.ownerId,
        memberIds: [data.ownerId], // Native array, not JSON string
        inviteCode: Math.random().toString(36).substring(2, 10).toUpperCase(),
        settings: JSON.stringify({
          allowPublicSignup: false,
          requireApproval: true,
          enableNotifications: true,
          enableIntegrations: false,
        }),
      };

      const response = await resources.create('workspaces', 'unique()',
        workspaceData
      );

      // Parse the response
      const workspace = {
        ...response,
        settings: JSON.parse(response.settings as any),
        memberIds: Array.isArray(response.memberIds) ? response.memberIds : [response.memberIds],
      };

      return workspace as unknown as Workspace;
    },
    onSuccess: (newWorkspace) => {
      // 1. Invalidate workspace list
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });

      // 2. CRITICAL: Clear ALL workspace-scoped cached data to prevent leakage
      // This ensures the new workspace starts completely empty
      queryClient.removeQueries({ queryKey: ['projects'] });
      queryClient.removeQueries({ queryKey: ['project'] });
      queryClient.removeQueries({ queryKey: ['tasks'] });
      queryClient.removeQueries({ queryKey: ['task'] });
      queryClient.removeQueries({ queryKey: ['workspace-tasks'] });
      queryClient.removeQueries({ queryKey: ['epics'] });
      queryClient.removeQueries({ queryKey: ['epic'] });
      queryClient.removeQueries({ queryKey: ['sprints'] });
      queryClient.removeQueries({ queryKey: ['sprint'] });
      queryClient.removeQueries({ queryKey: ['workspace-sprints'] });
      queryClient.removeQueries({ queryKey: ['requirements'] });
      queryClient.removeQueries({ queryKey: ['functional-requirements'] });
      queryClient.removeQueries({ queryKey: ['functional-requirement'] });
      queryClient.removeQueries({ queryKey: ['client-requirements'] });
      queryClient.removeQueries({ queryKey: ['client-requirement'] });
      queryClient.removeQueries({ queryKey: ['attendance'] });
      queryClient.removeQueries({ queryKey: ['leave-requests'] });
      queryClient.removeQueries({ queryKey: ['leave-request'] });
      queryClient.removeQueries({ queryKey: ['notifications'] });
      queryClient.removeQueries({ queryKey: ['analytics'] });
      queryClient.removeQueries({ queryKey: ['workspace-analytics'] });
      queryClient.removeQueries({ queryKey: ['team'] });
      queryClient.removeQueries({ queryKey: ['workspace-members'] });
      queryClient.removeQueries({ queryKey: ['activity'] });
      queryClient.removeQueries({ queryKey: ['comments'] });
      queryClient.removeQueries({ queryKey: ['time-entries'] });

      // 3. ? CRITICAL: Set new workspace as current workspace
      // This ensures the newly created workspace becomes active immediately
      localStorage.setItem('currentWorkspaceId', newWorkspace.id);

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

      // Convert settings to JSON string if provided
      const updateData: any = { ...updates };
      if (updates.settings) {
        updateData.settings = JSON.stringify(updates.settings);
      }

      const response = await resources.update('workspaces', workspaceId,
        updateData
      );

      // Parse the response
      const workspace = {
        ...response,
        settings: typeof response.settings === 'string'
          ? JSON.parse(response.settings)
          : response.settings,
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
      const { query } = await import('@/lib/api/client');

      // Cascade delete all workspace-related data
      try {
        // Delete all projects in the workspace
        const projectsQuery = await resources.list('projects', [query.equal('workspaceId', workspaceId), query.limit(500)]
        );

        for (const project of projectsQuery.items) {
          await resources.remove('projects', project.id);
        }

        // Delete all tasks
        const tasksQuery = await resources.list('tasks', [query.equal('workspaceId', workspaceId), query.limit(500)]
        );

        for (const task of tasksQuery.items) {
          await resources.remove('tasks', task.id);
        }

        // Delete all epics
        try {
          const epicsQuery = await resources.list('epics', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const epic of epicsQuery.items) {
            await resources.remove('epics', epic.id);
          }
        } catch (error) {
          logger.warn('Error deleting epics', { error });
        }

        // Delete all sprints
        try {
          const sprintsQuery = await resources.list('sprints', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const sprint of sprintsQuery.items) {
            await resources.remove('sprints', sprint.id);
          }
        } catch (error) {
          logger.warn('Error deleting sprints', { error });
        }

        // Delete all requirements
        try {
          const requirementsQuery = await resources.list('functional_requirements', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const req of requirementsQuery.items) {
            await resources.remove('functional_requirements', req.id);
          }
        } catch (error) {
          logger.warn('Error deleting functional requirements', { error });
        }

        try {
          const clientReqsQuery = await resources.list('client_requirements', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const req of clientReqsQuery.items) {
            await resources.remove('client_requirements', req.id);
          }
        } catch (error) {
          logger.warn('Error deleting client requirements', { error });
        }

        // Delete attendance records
        try {
          const attendanceQuery = await resources.list('attendance', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const record of attendanceQuery.items) {
            await resources.remove('attendance', record.id);
          }
        } catch (error) {
          logger.warn('Error deleting attendance records', { error });
        }

        // Delete leave requests
        try {
          const leaveQuery = await resources.list('leave_requests', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const leave of leaveQuery.items) {
            await resources.remove('leave_requests', leave.id);
          }
        } catch (error) {
          logger.warn('Error deleting leave requests', { error });
        }

        // Delete notifications
        try {
          const notificationsQuery = await resources.list('notifications', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const notification of notificationsQuery.items) {
            await resources.remove('notifications', notification.id);
          }
        } catch (error) {
          logger.warn('Error deleting notifications', { error });
        }

        // Delete workspace members
        try {
          const membersQuery = await resources.list('workspace_members', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const member of membersQuery.items) {
            await resources.remove('workspace_members', member.id);
          }
        } catch (error) {
          logger.warn('Error deleting workspace members', { error });
        }

        // Delete email invitations
        try {
          const invitationsQuery = await resources.list('email_invitations', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const invitation of invitationsQuery.items) {
            await resources.remove('email_invitations', invitation.id);
          }
        } catch (error) {
          logger.warn('Error deleting email invitations', { error });
        }

        // Delete invite codes
        try {
          const codesQuery = await resources.list('invite_codes', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const code of codesQuery.items) {
            await resources.remove('invite_codes', code.id);
          }
        } catch (error) {
          logger.warn('Error deleting invite codes', { error });
        }

        // Delete time entries
        try {
          const timeEntriesQuery = await resources.list('time_entries', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const entry of timeEntriesQuery.items) {
            await resources.remove('time_entries', entry.id);
          }
        } catch (error) {
          logger.warn('Error deleting time entries', { error });
        }

        // Delete active timers
        try {
          const timersQuery = await resources.list('active_timers', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const timer of timersQuery.items) {
            await resources.remove('active_timers', timer.id);
          }
        } catch (error) {
          logger.warn('Error deleting active timers', { error });
        }

        // Delete task comments
        try {
          const taskCommentsQuery = await resources.list('task_comments', [query.equal('workspaceId', workspaceId), query.limit(500)]
          );

          for (const comment of taskCommentsQuery.items) {
            await resources.remove('task_comments', comment.id);
          }
        } catch (error) {
          logger.warn('Error deleting task comments', { error });
        }

        // Finally, delete the workspace itself
        await resources.remove('workspaces', workspaceId
        );
      } catch (error) {
        logger.error('Error during workspace deletion', { error });
        throw error;
      }
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
      email: string;
      role: string;
      inviterName: string;
    }) => {
      // Get workspace details
      const workspace = await resources.get('workspaces', data.workspaceId
      ) as any;

      // Generate invite code
      const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

      // Send invitation email via API route (server-side)
      const emailResponse = await fetch('/api/send-invitation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: data.email,
          workspaceName: workspace.name,
          inviterName: data.inviterName,
          inviteCode,
        }),
      });

      const emailResult = await emailResponse.json();

      if (!emailResponse.ok || !emailResult.success) {
        throw new Error(emailResult.error || 'Failed to send invitation email');
      }

      // Store invitation in database for tracking
      // You can create a separate collection for invitations if needed
      // For now, we'll just return the data

      return { ...data, inviteCode, emailSent: true };
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', variables.workspaceId] });
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
    mutationFn: async (data: {
      inviteCode: string;
      userId: string;
      userName: string;
      userEmail: string;
      userAvatar?: string;
      message?: string;
    }) => {
      // Search for workspace by invite code
      const workspaces = await resources.list('workspaces', [query.equal('inviteCode', data.inviteCode)]
      );

      if (workspaces.items.length === 0) {
        throw new Error('Invalid invite code. Please check and try again.');
      }

      const workspace = workspaces.items[0] as any;

      // Check if user is already the owner
      if (workspace.ownerId === data.userId) {
        throw new Error('You are already the owner of this workspace');
      }

      // Get current members from the workspace array field.
      const currentMembers = Array.isArray(workspace.memberIds)
        ? workspace.memberIds
        : [];

      if (currentMembers.includes(data.userId)) {
        throw new Error('You are already a member of this workspace');
      }

      // Check if user already has a pending request
      const existingRequests = await resources.list('join_requests', [
        query.equal('workspaceId', workspace.id),
        query.equal('userId', data.userId),
        query.equal('status', 'PENDING')
      ]
      );

      if (existingRequests.items.length > 0) {
        throw new Error('You already have a pending join request for this workspace');
      }

      // Create a join request instead of directly adding the user
      const joinRequest = await resources.create('join_requests', 'unique()',
        {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          userId: data.userId,
          userName: data.userName,
          userEmail: data.userEmail,
          userAvatar: data.userAvatar || '',
          inviteCode: data.inviteCode,
          status: 'PENDING',
          message: data.message || '',
          requestedAt: new Date().toISOString(),
        }
      );

      return { joinRequest, workspace };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['join-requests'] });
      toast({
        title: 'Request Sent',
        description: 'Your join request has been sent to the workspace owner for approval',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description: (error instanceof Error ? error.message : String(error)) || 'Failed to join workspace',
        variant: 'destructive',
      });
      throw error;
    },
  });
}

// Get workspace members (users) by workspace id
export function useWorkspaceMembers(workspaceId?: string) {
  return useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      // Get workspace to access memberIds
      const workspace = await resources.get('workspaces', workspaceId
      );

      const memberIds = Array.isArray(workspace.memberIds) ? workspace.memberIds : [];

      if (memberIds.length === 0) return [];

      // Fetch user details from the users endpoint.
      try {
        // Fetch all users and filter by the workspace member id list.
        const usersResponse = await resources.list('users', [query.limit(100)]
        );

        // Filter to only members of this workspace
        const members = usersResponse.items.filter((user: any) =>
          memberIds.includes(user.id)
        );

        return members;
      } catch (error) {
        // If user lookup fails, return basic member labels.
        logger.warn('Could not fetch user details', { error });
        return memberIds.map((id: string) => ({
          id: id,
          name: 'User ' + id.slice(0, 8),
          email: '',
        }));
      }
    },
    enabled: !!workspaceId,
  });
}

