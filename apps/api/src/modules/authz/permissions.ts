/**
 * Workspace-domain permissions + the default role→permission map.
 *
 * Permissions resolve from THIS map (built-in roles) plus a workspace's
 * custom `WorkspaceRole.permissions` JSON. The normalized authz.* tables are
 * the documented end-state, enabled later by a database migration + seed.
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
  // Projects
  ProjectRead: 'project:read',
  ProjectCreate: 'project:create',
  ProjectUpdate: 'project:update',
  ProjectDelete: 'project:delete',
  // Requirements (client + functional)
  RequirementRead: 'requirement:read',
  RequirementWrite: 'requirement:write',
  // Planning (epics, sprints, retrospectives)
  PlanningRead: 'planning:read',
  PlanningWrite: 'planning:write',
  // Tasks (task + labels; comments/kanban are unscoped, see task.prisma)
  TaskRead: 'task:read',
  TaskWrite: 'task:write',
  // HR (attendance, leave, time). Members submit their own records
  // (HrWrite is in the baseline); only managers approve (Leave/Time Approve).
  HrRead: 'hr:read',
  HrWrite: 'hr:write',
  LeaveApprove: 'leave:approve',
  TimeApprove: 'time:approve',
  // Notifications + activity. Members manage their own notifications
  // and saved searches, and read the workspace activity trail (all baseline).
  NotificationRead: 'notification:read',
  NotificationWrite: 'notification:write',
  ActivityRead: 'activity:read',
  ActivityWrite: 'activity:write',
  // Files. Upload/delete require only authenticated membership (no
  // extra role check), so both are in the member baseline.
  FileRead: 'file:read',
  FileWrite: 'file:write',
  // Integrations, scoped by project→workspace membership. Reads are
  // baseline; writes (which hold access tokens) require the integration:write
  // permission.
  IntegrationRead: 'integration:read',
  IntegrationWrite: 'integration:write',
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
  Permission.IntegrationRead,
  // IntegrationWrite is NOT baseline — writes carry access tokens, so under
  // enforced RBAC only managers manage integrations (membership floor when off).
];

/** Default permissions for the 7 built-in roles. Tunable; seeded into
 *  the normalized tables when those are enabled. */
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
