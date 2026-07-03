/**
 * Workspace-domain permissions + the default role→permission map (ADR-0005).
 *
 * Phase 2 resolves permissions from THIS map (built-in roles) plus a workspace's
 * custom `WorkspaceRole.permissions` JSON (legacy path). The normalized authz.*
 * tables are the documented end-state, enabled later by a migration + seed.
 */
export const Permission = {
  WorkspaceRead: 'workspace:read',
  WorkspaceUpdate: 'workspace:update',
  WorkspaceDelete: 'workspace:delete',
  MemberRead: 'member:read',
  MemberInvite: 'member:invite',
  MemberUpdate: 'member:update',
  MemberRemove: 'member:remove',
  RoleManage: 'role:manage',
  InviteManage: 'invite:manage',
  JoinManage: 'join:manage',
  // Phase 3 — projects
  ProjectRead: 'project:read',
  ProjectCreate: 'project:create',
  ProjectUpdate: 'project:update',
  ProjectDelete: 'project:delete',
  // Phase 4 — requirements (client + functional)
  RequirementRead: 'requirement:read',
  RequirementWrite: 'requirement:write',
  // Phase 5 — planning (epics, sprints, retrospectives)
  PlanningRead: 'planning:read',
  PlanningWrite: 'planning:write',
  // Phase 6 — tasks (task + labels; comments/kanban are unscoped, see task.prisma)
  TaskRead: 'task:read',
  TaskWrite: 'task:write',
  // Phase 8 — HR (attendance, leave, time). Members submit their own records
  // (HrWrite is in the baseline); only managers approve (Leave/Time Approve).
  HrRead: 'hr:read',
  HrWrite: 'hr:write',
  LeaveApprove: 'leave:approve',
  TimeApprove: 'time:approve',
  // Phase 9 — notifications + activity. Members manage their own notifications
  // and saved searches, and read the workspace activity trail (all baseline).
  NotificationRead: 'notification:read',
  NotificationWrite: 'notification:write',
  ActivityRead: 'activity:read',
  ActivityWrite: 'activity:write',
  // Phase 10 — files. Django gated file upload/delete on authenticated
  // membership only (no role check), so both are in the member baseline.
  FileRead: 'file:read',
  FileWrite: 'file:write',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

const ALL: PermissionKey[] = Object.values(Permission);
/** Member baseline: all reads + submitting one's own HR records. */
const READ_ONLY: PermissionKey[] = [
  Permission.WorkspaceRead,
  Permission.MemberRead,
  Permission.ProjectRead,
  Permission.RequirementRead,
  Permission.PlanningRead,
  Permission.TaskRead,
  Permission.HrRead,
  Permission.HrWrite,
  Permission.NotificationRead,
  Permission.NotificationWrite,
  Permission.ActivityRead,
  Permission.ActivityWrite,
  Permission.FileRead,
  Permission.FileWrite,
];

/** Default permissions for the 7 built-in roles (A§5.1). Tunable; seeded into
 *  the normalized tables at cut-over. */
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  MANAGER: ALL,
  ASSISTANT_MANAGER: ALL.filter((p) => p !== Permission.WorkspaceDelete),
  SOFTWARE_DEVELOPER: READ_ONLY,
  DEVELOPER_INTERN: READ_ONLY,
  TESTER: READ_ONLY,
  CONTENT_ENGINEER: READ_ONLY,
  MEMBER: READ_ONLY,
};

/** Resolve a role's permission set: built-in map, else custom-role JSON, else read-only floor. */
export function permissionsForRole(role: string, customRolePermissions?: string[]): Set<string> {
  const builtin = ROLE_PERMISSIONS[role];
  if (builtin) return new Set(builtin);
  if (customRolePermissions && customRolePermissions.length > 0) {
    return new Set(customRolePermissions);
  }
  return new Set(READ_ONLY);
}
