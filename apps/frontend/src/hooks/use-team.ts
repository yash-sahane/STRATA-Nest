import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { workloadBandForTasks } from '@/lib/team-workload';

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  role:
  | 'MANAGER'
  | 'ASSISTANT_MANAGER'
  | 'SOFTWARE_DEVELOPER'
  | 'DEVELOPER_INTERN'
  | 'TESTER'
  | 'CONTENT_ENGINEER'
  | 'MEMBER';
  /**
   * The role exactly as stored on the membership. `role` above is normalized
   * for display and collapses anything unrecognised (a custom workspace role)
   * to MEMBER, so writes must round-trip THIS value or they silently demote
   * the member.
   */
  rawRole: string;
  workspaceId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED';
  /**
   * When this membership began. Attendance cannot be missing before it: a day
   * before somebody joined is not a day they failed to attend, and painting it
   * red told a user who joined on the 5th that they had missed the whole of the
   * previous month.
   */
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map workspace_members role names to TeamMember role keys
 */
function normalizeRole(role: string): TeamMember['role'] {
  const roleMap: Record<string, TeamMember['role']> = {
    // From workspace_members (human-readable) - exact matches
    Manager: 'MANAGER',
    'Assistant Manager': 'ASSISTANT_MANAGER',
    'Software Developer': 'SOFTWARE_DEVELOPER',
    'Software Developer Intern': 'DEVELOPER_INTERN',
    Tester: 'TESTER',
    'Content Engineer': 'CONTENT_ENGINEER',
    Member: 'MEMBER',
    // From CSV/API (uppercase keys)
    MANAGER: 'MANAGER',
    ASSISTANT_MANAGER: 'ASSISTANT_MANAGER',
    SOFTWARE_DEVELOPER: 'SOFTWARE_DEVELOPER',
    DEVELOPER_INTERN: 'DEVELOPER_INTERN',
    TESTER: 'TESTER',
    CONTENT_ENGINEER: 'CONTENT_ENGINEER',
    MEMBER: 'MEMBER',
  };

  return roleMap[role] || 'MEMBER';
}

/** Clamp to the three states the UI renders — an unmodelled one would make
 *  every STATUS_CONFIG lookup undefined and crash the whole table. */
function normalizeStatus(status: string): TeamMember['status'] {
  return status === 'INACTIVE' || status === 'INVITED' || status === 'ACTIVE' ? status : 'ACTIVE';
}

export function useTeamMembers(workspaceId?: string) {
  return useQuery({
    queryKey: ['team-members', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];

      // listAll, not list: the caller's own membership is what the whole
      // client-side permission model is derived from, and a single page would
      // drop it (and its role) in a workspace with more members than the page
      // size.
      const response = await resources.listAll('workspace_members', [
        query.equal('workspaceId', workspaceId),
      ]);

      // Map workspace_members to TeamMember interface
      return response.items.map((doc: any) => ({
        id: doc.id,
        userId: doc.userId,
        email: doc.email,
        name: doc.userName || doc.name,
        phone: doc.phone || '',
        avatar: doc.avatar || '',
        role: normalizeRole(doc.role),
        rawRole: doc.role || 'MEMBER',
        workspaceId: doc.workspaceId,
        status: normalizeStatus(doc.status || 'ACTIVE'),
        joinedAt: doc.joinedAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })) as TeamMember[];
    },
    enabled: !!workspaceId,
  });
}

export function useTeamMember(memberId?: string) {
  return useQuery({
    queryKey: ['team-member', memberId],
    queryFn: async () => {
      if (!memberId) return null;

      const response = await resources.get('workspace_members', memberId);

      return response as unknown as TeamMember;
    },
    enabled: !!memberId,
  });
}

export function useCreateTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<TeamMember, 'id' | 'createdAt' | 'updatedAt'>) => {
      const response = await resources.create('workspace_members', 'unique()',
        data
      );

      return response as unknown as TeamMember;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', variables.workspaceId] });
    },
  });
}

/** role/status are the only fields a membership PATCH accepts. */
export type TeamMemberUpdate = {
  role?: string;
  status?: TeamMember['status'];
};

export function useUpdateTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TeamMemberUpdate }) => {
      const response = await resources.update('workspace_members', id, data);

      return response as unknown as TeamMember;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', data.workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['team-member', data.id] });
    },
  });
}

export function useDeleteTeamMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, workspaceId }: { id: string; workspaceId: string }) => {
      await resources.remove('workspace_members', id);

      return { id, workspaceId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', data.workspaceId] });
    },
  });
}

// Role labels and colors
export const ROLE_CONFIG = {
  MANAGER: {
    label: 'Manager',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  },
  ASSISTANT_MANAGER: {
    label: 'Assistant Manager',
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  },
  SOFTWARE_DEVELOPER: {
    label: 'Software Developer',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  DEVELOPER_INTERN: {
    label: 'Software Developer Intern',
    color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  },
  TESTER: {
    label: 'Tester',
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  CONTENT_ENGINEER: {
    label: 'Content Engineer',
    color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  },
  MEMBER: {
    label: 'Member',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
} as const;

export const STATUS_CONFIG = {
  ACTIVE: {
    label: 'Active',
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  INACTIVE: {
    label: 'Inactive',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  // Spelled out because it is not what it sounds like: the API authorizes on
  // `status: 'ACTIVE'` alone, so an INVITED membership is a lockout, not a
  // pending welcome — and a bare "Invited" badge read as the opposite.
  INVITED: {
    label: 'Invited (no access)',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
} as const;

// Hook to get task counts per member for workload display.
export interface MemberTaskCount {
  userId: string;
  totalTasks: number;
  activeTasks: number; // TODO, IN_PROGRESS, REVIEW
  completedTasks: number; // DONE
  overdueTasks: number;
}

export function useMemberTaskCounts(workspaceId?: string) {
  return useQuery({
    queryKey: ['member-task-counts', workspaceId],
    queryFn: async () => {
      if (!workspaceId) return new Map<string, MemberTaskCount>();

      // listAll, not list(limit(1000)). The Resource Allocation card on the same
      // page derives its figures from useWorkspaceTasks, which walks every page,
      // so a workspace past 1000 tasks had the card and the table below it
      // counting different corpora on top of the band mismatch — and the
      // truncation was silent either way.
      const response = await resources.listAll('tasks', [
        query.equal('workspaceId', workspaceId),
      ]);

      const taskCounts = new Map<string, MemberTaskCount>();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      response.items.forEach((task: any) => {
        // Parse assigneeIds/assignedTo
        const assigneeIds = Array.isArray(task.assignedTo)
          ? task.assignedTo
          : typeof task.assigneeIds === 'string' && task.assigneeIds
            ? JSON.parse(task.assigneeIds)
            : Array.isArray(task.assigneeIds)
              ? task.assigneeIds
              : [];

        const status = task.status || 'BACKLOG';
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        const isOverdue = dueDate && dueDate < today && status !== 'DONE';

        assigneeIds.forEach((userId: string) => {
          if (!taskCounts.has(userId)) {
            taskCounts.set(userId, {
              userId,
              totalTasks: 0,
              activeTasks: 0,
              completedTasks: 0,
              overdueTasks: 0,
            });
          }

          const counts = taskCounts.get(userId)!;
          counts.totalTasks++;

          if (status === 'DONE') {
            counts.completedTasks++;
          } else {
            counts.activeTasks++;
          }

          if (isOverdue) {
            counts.overdueTasks++;
          }
        });
      });

      return taskCounts;
    },
    enabled: !!workspaceId,
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Workload level label and its text colour.
 *
 * Semantic *-text tokens rather than raw palette shades: the 600-weight colours
 * this used to return measure ~3.2:1 on a light card, under the 4.5:1 AA floor,
 * and carried no dark-mode variant at all. Only "Moderate" keeps a raw shade —
 * there is no token between warning and success — pinned to 700 so it passes.
 */
export function getWorkloadLevel(activeTasks: number): { label: string; color: string } {
  // Delegated to the shared band table. This function and getWorkloadStatus in
  // lib/team-workload each carried their own thresholds, and both render on
  // /team — one in the Resource Allocation card, one in the member table
  // directly below — so a member with seven open tasks read "Busy" here and
  // "Moderate" there.
  const band = workloadBandForTasks(activeTasks);
  return { label: band.label, color: band.color };
}

