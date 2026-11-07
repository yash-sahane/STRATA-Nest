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
  // Planning (epics, sprints)
  PlanningRead: 'planning:read',
  PlanningWrite: 'planning:write',
  // Tasks (comments are scoped through their task, see task.prisma)
  TaskRead: 'task:read',
  /** File a new task — a tester's bug, a developer's sub-task. Delivery roles. */
  TaskCreate: 'task:create',
  /** Delete tasks and mark them done (and so reopen them). Managers. Implies
   *  creating and changing them. */
  TaskWrite: 'task:write',
  /** Change an existing task — status, title, progress, assignees, labels,
   *  dependency edges. Split out from TaskWrite so the delivery team can work the
   *  board without also gaining the ability to delete tasks. Moving a task into
   *  another sprint, epic or requirement is planning (planning:write). */
  TaskUpdate: 'task:update',
  // HR (attendance, leave, time). Members submit their own records
  // (HrWrite is in the baseline); only managers approve (Leave/Time Approve).
  HrRead: 'hr:read',
  HrWrite: 'hr:write',
  LeaveApprove: 'leave:approve',
  TimeApprove: 'time:approve',
  // Notifications + activity. Members manage their own notifications and
  // read the workspace activity trail (all baseline).
  NotificationRead: 'notification:read',
  NotificationWrite: 'notification:write',
  ActivityRead: 'activity:read',
  // Files. Reading is baseline; uploading and deleting take file:write, which
  // the delivery roles and managers hold.
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
/** Every valid permission string — used to reject unknown keys on custom roles. */
export const PERMISSION_KEYS: ReadonlySet<string> = new Set<string>(ALL);
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
  Permission.FileRead,
  // FileWrite is NOT baseline. MEMBER is the documented read-only observer, and
  // it could upload into any project it could see and delete ANY file in the
  // workspace, including files a manager had uploaded. Delivery roles keep it
  // (they attach mockups and specs); MEMBER does not.
  Permission.IntegrationRead,
  // IntegrationWrite is NOT baseline — writes carry access tokens, so under
  // enforced RBAC only managers manage integrations (membership floor when off).
];

/** What every membership holds whatever its role — the floor an unrecognised
 *  role name falls to. Granting it is never an escalation. */
export const BASELINE_PERMISSIONS: ReadonlySet<string> = new Set<string>(READ_ONLY);

/**
 * Delivery roles: the member baseline plus `task:update` and `task:create`.
 *
 * Without this the whole delivery team was read-only on tasks — a developer
 * could not move a card assigned to them, edit its title, or record progress,
 * which makes the board unusable for the people who actually work it.
 *
 * `file:write` comes with it: the delivery team attaches mockups and specs.
 *
 * Deliberately NOT `task:write`: that one permission also covers creating and
 * deleting tasks and marking them done, so granting it to work the board would
 * have handed an intern the ability to delete work. Creation, deletion, labels
 * and the DONE transition stay with managers. MEMBER keeps the plain read-only
 * floor as the generic observer role.
 */
/*
 * `task:create` came later. Without it a TESTER who found a defect had no way to
 * file it — the work it is for — and an intern could not split their own task.
 * Filing is not deleting: nobody's work can be lost by it, and the DONE
 * transition still waits for a manager.
 */
const DELIVERY: PermissionKey[] = [
  ...READ_ONLY,
  Permission.TaskUpdate,
  Permission.TaskCreate,
  Permission.FileWrite,
];

/**
 * Default permissions for the 7 built-in roles. Tunable; seeded into
 * the normalized tables when those are enabled.
 *
 * Null-prototype on purpose: role names are caller-supplied strings, and on a
 * plain object literal `ROLE_PERMISSIONS['constructor' | 'toString' |
 * '__proto__']` resolves to an INHERITED member. Every truthiness test on the
 * lookup (`assertValidRole`, `assertNotBuiltIn`, `permissionsForRole`) then
 * accepted those names as built-in roles and `new Set(Object)` threw a
 * TypeError on the next permission check — a 500 on every route in the
 * workspace. `isBuiltInRole` below is the checked way to ask the question.
 */
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = Object.assign(
  Object.create(null) as Record<string, PermissionKey[]>,
  {
    MANAGER: ALL,
    ASSISTANT_MANAGER: ALL.filter((p) => p !== Permission.WorkspaceDelete),
    SOFTWARE_DEVELOPER: DELIVERY,
    DEVELOPER_INTERN: DELIVERY,
    TESTER: DELIVERY,
    CONTENT_ENGINEER: DELIVERY,
    MEMBER: READ_ONLY,
  },
);

/** Whether `role` names one of the built-in roles. Own-property test, so no
 *  Object.prototype key can masquerade as a role. */
export function isBuiltInRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

/**
 * Permissions that are useless without another. A role that may create,
 * delete and complete tasks but not change them could make a task and then do
 * nothing with it — the server's own status change runs through the update
 * rule. The role editor added the pair together; the API accepted either alone.
 */
const IMPLIES: Readonly<Record<string, readonly string[]>> = {
  [Permission.TaskWrite]: [Permission.TaskUpdate, Permission.TaskCreate],
};

/** `keys` with everything they imply added. */
export function withImplied(keys: Iterable<string>): string[] {
  const out = new Set<string>(keys);
  for (const key of [...out]) for (const implied of IMPLIES[key] ?? []) out.add(implied);
  return [...out];
}

/** Resolve a role's permission set: built-in map, else custom-role JSON, else read-only floor. */
export function permissionsForRole(role: string, customRolePermissions?: string[]): Set<string> {
  const builtin = isBuiltInRole(role) ? ROLE_PERMISSIONS[role] : undefined;
  // Array.isArray, not truthiness: the lookup must never yield a non-iterable.
  if (Array.isArray(builtin)) return new Set(builtin);
  if (customRolePermissions && customRolePermissions.length > 0) {
    return new Set(withImplied(customRolePermissions));
  }
  return new Set(READ_ONLY);
}
