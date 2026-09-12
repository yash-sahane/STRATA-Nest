/**
 * Permission System
 * Defines role hierarchy and permission matrix
 */

// Role hierarchy (higher number = more permissions)
export const ROLE_HIERARCHY = {
  MANAGER: 100,
  ASSISTANT_MANAGER: 80,
  SOFTWARE_DEVELOPER: 60,
  TESTER: 50,
  DEVELOPER_INTERN: 40,
  CONTENT_ENGINEER: 40,
  MEMBER: 20,
} as const;

/** The seven roles this module has a permission matrix for. */
export type BuiltInRole = keyof typeof ROLE_HIERARCHY;

/**
 * A role as it actually arrives from the server: a free string.
 *
 * `WorkspaceMember.role` is `String @default("MEMBER")` in Prisma and
 * `@IsOptional() @IsString() role?: string` in the API's DTO, and a workspace
 * may define custom `WorkspaceRole` rows with any name. Declaring this a CLOSED
 * union let the compiler certify a value it cannot actually check — which is
 * how an unguarded `ROLE_PERMISSIONS[role].includes(...)` shipped and threw
 * `Cannot read properties of undefined` during render for every member holding
 * a custom role.
 *
 * The second arm is the standard "open union" trick: intersecting `string` with
 * an empty object type stops TypeScript collapsing the union to plain `string`,
 * so editors still complete the seven built-in names while any string is
 * accepted. `Record<never, never>` rather than `{}` — the latter is banned by
 * @typescript-eslint/ban-types and means "any non-nullish value".
 */
export type Role = BuiltInRole | (string & Record<never, never>);

// Permission actions
export enum Permission {
  // Project permissions
  VIEW_PROJECTS = 'VIEW_PROJECTS',
  CREATE_PROJECT = 'CREATE_PROJECT',
  EDIT_PROJECT = 'EDIT_PROJECT',
  DELETE_PROJECT = 'DELETE_PROJECT',
  MANAGE_PROJECT_SETTINGS = 'MANAGE_PROJECT_SETTINGS',

  // Task permissions
  VIEW_TASKS = 'VIEW_TASKS',
  CREATE_TASK = 'CREATE_TASK',
  EDIT_OWN_TASK = 'EDIT_OWN_TASK',
  EDIT_ANY_TASK = 'EDIT_ANY_TASK',
  DELETE_TASK = 'DELETE_TASK',
  ASSIGN_TASK = 'ASSIGN_TASK',

  // Epic permissions
  VIEW_EPICS = 'VIEW_EPICS',
  CREATE_EPIC = 'CREATE_EPIC',
  EDIT_EPIC = 'EDIT_EPIC',
  DELETE_EPIC = 'DELETE_EPIC',

  // Requirement permissions (client requirements and functional requirements)
  VIEW_REQUIREMENTS = 'VIEW_REQUIREMENTS',
  CREATE_REQUIREMENT = 'CREATE_REQUIREMENT',
  EDIT_REQUIREMENT = 'EDIT_REQUIREMENT',
  DELETE_REQUIREMENT = 'DELETE_REQUIREMENT',

  // Functional requirement permissions
  VIEW_FUNCTIONAL_REQUIREMENTS = 'VIEW_FUNCTIONAL_REQUIREMENTS',
  CREATE_FUNCTIONAL_REQUIREMENT = 'CREATE_FUNCTIONAL_REQUIREMENT',
  EDIT_FUNCTIONAL_REQUIREMENT = 'EDIT_FUNCTIONAL_REQUIREMENT',
  DELETE_FUNCTIONAL_REQUIREMENT = 'DELETE_FUNCTIONAL_REQUIREMENT',

  // Sprint permissions
  VIEW_SPRINTS = 'VIEW_SPRINTS',
  CREATE_SPRINT = 'CREATE_SPRINT',
  EDIT_SPRINT = 'EDIT_SPRINT',
  DELETE_SPRINT = 'DELETE_SPRINT',

  // Team permissions
  VIEW_TEAM = 'VIEW_TEAM',
  INVITE_MEMBER = 'INVITE_MEMBER',
  EDIT_MEMBER = 'EDIT_MEMBER',
  REMOVE_MEMBER = 'REMOVE_MEMBER',

  // Workspace permissions
  VIEW_WORKSPACE = 'VIEW_WORKSPACE',
  EDIT_WORKSPACE = 'EDIT_WORKSPACE',
  DELETE_WORKSPACE = 'DELETE_WORKSPACE',
  MANAGE_WORKSPACE_SETTINGS = 'MANAGE_WORKSPACE_SETTINGS',

  // Leave permissions
  REQUEST_LEAVE = 'REQUEST_LEAVE',
  APPROVE_LEAVE = 'APPROVE_LEAVE',
  REJECT_LEAVE = 'REJECT_LEAVE',

  // Time-tracking permissions. Mirrors the API's `time:approve`, which is part
  // of ALL and so belongs to MANAGER and ASSISTANT_MANAGER only — logging your
  // own time is part of the member baseline (hr:write) and needs no permission.
  APPROVE_TIME = 'APPROVE_TIME',

  // Analytics permissions
  VIEW_ANALYTICS = 'VIEW_ANALYTICS',
  VIEW_TEAM_ANALYTICS = 'VIEW_TEAM_ANALYTICS',
}

/**
 * What ANY active membership can do, whatever role name it carries.
 *
 * Every entry is a pure read, and reads are scoped by MEMBERSHIP server-side
 * rather than by permission: `ScopedCrudService` narrows a list by a permission
 * only where it declares a `readPermission` (invitations, invite codes, join
 * requests — none of which this enum models), and there is no analytics
 * endpoint at all, so those screens are ordinary workspace reads. A custom role
 * granting nothing but `member:invite` really can read the app, so resolving it
 * to an empty set would blank navigation the API happily serves.
 */
const MEMBERSHIP_FLOOR: Permission[] = [
  Permission.VIEW_PROJECTS,
  Permission.VIEW_TASKS,
  Permission.VIEW_EPICS,
  Permission.VIEW_REQUIREMENTS,
  Permission.VIEW_FUNCTIONAL_REQUIREMENTS,
  Permission.VIEW_SPRINTS,
  Permission.VIEW_TEAM,
  Permission.VIEW_WORKSPACE,
  Permission.VIEW_ANALYTICS,
];

/**
 * Member baseline — mirrors READ_ONLY in the API's role matrix
 * (apps/api/src/modules/authz/permissions.ts): every read, plus submitting
 * one's own HR records. The API maps MEMBER to exactly this set, so anything
 * extra here renders a control whose submit returns 403. The four delivery
 * roles extend it with task writes — see DELIVERY below.
 *
 * REQUEST_LEAVE is the one non-read in it: `POST /leave_requests` is
 * `@RequirePermission(hr:write)`, so it follows that key (see
 * API_PERMISSION_MAP) rather than sitting on the membership floor above.
 */
const READ_ONLY: Permission[] = [...MEMBERSHIP_FLOOR, Permission.REQUEST_LEAVE];

/**
 * Delivery roles: the member baseline plus the right to change a task.
 *
 * Mirrors DELIVERY in the API matrix (apps/api/src/modules/authz/permissions.ts),
 * where these four roles hold `task:update` — edit, move, progress, assign and
 * link an EXISTING task. Creating one, deleting one, managing labels and the
 * final DONE transition all still require `task:write`, which they do not have,
 * so CREATE_TASK and DELETE_TASK are deliberately absent here.
 */
const DELIVERY: Permission[] = [
  ...READ_ONLY,
  Permission.EDIT_OWN_TASK,
  Permission.EDIT_ANY_TASK,
  Permission.ASSIGN_TASK,
];

// Permission matrix: Role -> Permissions. Kept in step with the API matrix —
// the API is the enforcement point, so a role must never be granted more here.
export const ROLE_PERMISSIONS: Record<BuiltInRole, Permission[]> = {
  MANAGER: [
    // All permissions
    Permission.VIEW_PROJECTS,
    Permission.CREATE_PROJECT,
    Permission.EDIT_PROJECT,
    Permission.DELETE_PROJECT,
    Permission.MANAGE_PROJECT_SETTINGS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,
    Permission.EDIT_ANY_TASK,
    Permission.DELETE_TASK,
    Permission.ASSIGN_TASK,

    Permission.VIEW_EPICS,
    Permission.CREATE_EPIC,
    Permission.EDIT_EPIC,
    Permission.DELETE_EPIC,

    Permission.VIEW_REQUIREMENTS,
    Permission.CREATE_REQUIREMENT,
    Permission.EDIT_REQUIREMENT,
    Permission.DELETE_REQUIREMENT,

    Permission.VIEW_FUNCTIONAL_REQUIREMENTS,
    Permission.CREATE_FUNCTIONAL_REQUIREMENT,
    Permission.EDIT_FUNCTIONAL_REQUIREMENT,
    Permission.DELETE_FUNCTIONAL_REQUIREMENT,

    Permission.VIEW_SPRINTS,
    Permission.CREATE_SPRINT,
    Permission.EDIT_SPRINT,
    Permission.DELETE_SPRINT,

    Permission.VIEW_TEAM,
    Permission.INVITE_MEMBER,
    Permission.EDIT_MEMBER,
    Permission.REMOVE_MEMBER,

    Permission.VIEW_WORKSPACE,
    Permission.EDIT_WORKSPACE,
    Permission.DELETE_WORKSPACE,
    Permission.MANAGE_WORKSPACE_SETTINGS,

    Permission.REQUEST_LEAVE,
    Permission.APPROVE_LEAVE,
    Permission.REJECT_LEAVE,
    Permission.APPROVE_TIME,

    Permission.VIEW_ANALYTICS,
    Permission.VIEW_TEAM_ANALYTICS,
  ],

  // The API grants ASSISTANT_MANAGER everything except workspace:delete.
  ASSISTANT_MANAGER: [
    Permission.VIEW_PROJECTS,
    Permission.CREATE_PROJECT,
    Permission.EDIT_PROJECT,
    Permission.DELETE_PROJECT,
    Permission.MANAGE_PROJECT_SETTINGS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,
    Permission.EDIT_ANY_TASK,
    Permission.DELETE_TASK,
    Permission.ASSIGN_TASK,

    Permission.VIEW_EPICS,
    Permission.CREATE_EPIC,
    Permission.EDIT_EPIC,
    Permission.DELETE_EPIC,

    Permission.VIEW_REQUIREMENTS,
    Permission.CREATE_REQUIREMENT,
    Permission.EDIT_REQUIREMENT,
    Permission.DELETE_REQUIREMENT,

    Permission.VIEW_FUNCTIONAL_REQUIREMENTS,
    Permission.CREATE_FUNCTIONAL_REQUIREMENT,
    Permission.EDIT_FUNCTIONAL_REQUIREMENT,
    Permission.DELETE_FUNCTIONAL_REQUIREMENT,

    Permission.VIEW_SPRINTS,
    Permission.CREATE_SPRINT,
    Permission.EDIT_SPRINT,
    Permission.DELETE_SPRINT,

    Permission.VIEW_TEAM,
    Permission.INVITE_MEMBER,
    Permission.EDIT_MEMBER,
    Permission.REMOVE_MEMBER,

    Permission.VIEW_WORKSPACE,
    Permission.EDIT_WORKSPACE,
    Permission.MANAGE_WORKSPACE_SETTINGS,

    Permission.REQUEST_LEAVE,
    Permission.APPROVE_LEAVE,
    Permission.REJECT_LEAVE,
    Permission.APPROVE_TIME,

    Permission.VIEW_ANALYTICS,
    Permission.VIEW_TEAM_ANALYTICS,
  ],

  SOFTWARE_DEVELOPER: DELIVERY,
  TESTER: DELIVERY,
  DEVELOPER_INTERN: DELIVERY,
  CONTENT_ENGINEER: DELIVERY,
  MEMBER: READ_ONLY,
};

/** Whether `role` is one of the seven this module has a matrix for. */
export function isBuiltInRole(role: string): role is BuiltInRole {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}

/**
 * The API's permission keys — the strings a custom `WorkspaceRole.permissions`
 * array actually holds — mapped to the coarser actions this module models.
 *
 * `WorkspaceAccessService.permissionsOfRole` resolves a membership against
 * exactly that array, so this is the client's translation of the server's own
 * answer. Keys with no UI counterpart (`role:manage`, `invite:manage`,
 * `join:manage`, `hr:read`, `file:*`, `notification:*`, `activity:*`,
 * `integration:*`) are deliberately absent: nothing in this enum gates on them.
 *
 * Null prototype, as in the API matrix: the keys arrive from the server, and on
 * a plain object literal `API_PERMISSION_MAP['constructor']` resolves to an
 * INHERITED member that is not an array.
 */
const API_PERMISSION_MAP: Record<string, Permission[]> = Object.assign(
  Object.create(null) as Record<string, Permission[]>,
  {
    'workspace:read': [Permission.VIEW_WORKSPACE],
    'workspace:update': [Permission.EDIT_WORKSPACE, Permission.MANAGE_WORKSPACE_SETTINGS],
    'workspace:delete': [Permission.DELETE_WORKSPACE],
    'member:read': [Permission.VIEW_TEAM],
    'member:invite': [Permission.INVITE_MEMBER],
    'member:update': [Permission.EDIT_MEMBER],
    'member:remove': [Permission.REMOVE_MEMBER],
    'project:read': [Permission.VIEW_PROJECTS],
    'project:create': [Permission.CREATE_PROJECT],
    'project:update': [Permission.EDIT_PROJECT, Permission.MANAGE_PROJECT_SETTINGS],
    'project:delete': [Permission.DELETE_PROJECT],
    'requirement:read': [Permission.VIEW_REQUIREMENTS, Permission.VIEW_FUNCTIONAL_REQUIREMENTS],
    'requirement:write': [
      Permission.CREATE_REQUIREMENT,
      Permission.EDIT_REQUIREMENT,
      Permission.DELETE_REQUIREMENT,
      Permission.CREATE_FUNCTIONAL_REQUIREMENT,
      Permission.EDIT_FUNCTIONAL_REQUIREMENT,
      Permission.DELETE_FUNCTIONAL_REQUIREMENT,
    ],
    'planning:read': [Permission.VIEW_EPICS, Permission.VIEW_SPRINTS],
    'planning:write': [
      Permission.CREATE_EPIC,
      Permission.EDIT_EPIC,
      Permission.DELETE_EPIC,
      Permission.CREATE_SPRINT,
      Permission.EDIT_SPRINT,
      Permission.DELETE_SPRINT,
    ],
    'task:read': [Permission.VIEW_TASKS],
    // Split exactly as the API splits it: `task:write` is create / delete /
    // label / the DONE transition, while changing an existing card is
    // `task:update`. Collapsing the two would offer a delivery role a Delete.
    'task:write': [Permission.CREATE_TASK, Permission.DELETE_TASK],
    'task:update': [Permission.EDIT_OWN_TASK, Permission.EDIT_ANY_TASK, Permission.ASSIGN_TASK],
    'hr:write': [Permission.REQUEST_LEAVE],
    // VIEW_TEAM_ANALYTICS rides with leave:approve because that is the key the
    // server actually scopes OTHER PEOPLE's records on: `scopeQueryToCaller` in
    // leave.services.ts widens a list past the caller's own rows only for a
    // principal holding it. It is what makes the two built-in manager roles —
    // and only them — hold it in the matrix above.
    'leave:approve': [
      Permission.APPROVE_LEAVE,
      Permission.REJECT_LEAVE,
      Permission.VIEW_TEAM_ANALYTICS,
    ],
    'time:approve': [Permission.APPROVE_TIME],
  },
);

/**
 * Translate a role's stored permission keys into UI permissions.
 *
 * The floor is added because the reads it covers are authorised by holding the
 * membership, not by a key (see MEMBERSHIP_FLOOR). `*` is the wildcard
 * `WorkspaceAccessService.permissions` answers with for a platform admin.
 */
export function permissionsFromKeys(keys: readonly string[]): Permission[] {
  if (keys.includes('*')) return [...ROLE_PERMISSIONS.MANAGER];
  const resolved = new Set<Permission>(MEMBERSHIP_FLOOR);
  for (const key of keys) {
    for (const permission of API_PERMISSION_MAP[key] ?? []) resolved.add(permission);
  }
  return [...resolved];
}

/**
 * Resolve a role name to its permission list — TOTAL, for any string.
 *
 * Mirrors `WorkspaceAccessService.permissionsOfRole` term for term: the
 * built-in matrix wins (a custom row of a built-in name is inert server-side,
 * which is why the API refuses to create one), else the role's own permission
 * keys, else the READ_ONLY floor for a name nothing resolves — not `[]`, which
 * would hide every screen, and not MANAGER, because the client must never
 * render an affordance the server will refuse.
 *
 * `grantedKeys` is the custom role's `permissions` array, which the client now
 * reads from `/api/v1/workspace_roles` (see `useMyRoleDefinitions`). Resolving
 * WITHOUT it was the bug: every custom-role member was answered with the floor,
 * so a role holding `member:invite` — which the API authorises, `POST
 * /users/invite` as that principal returning 201 — rendered no Invite button
 * anywhere in the UI.
 *
 * Own-property test, so no Object.prototype key ('constructor', '__proto__')
 * can masquerade as a role.
 */
export function permissionsOfRole(
  role: Role,
  grantedKeys?: readonly string[] | null,
): Permission[] {
  if (isBuiltInRole(role)) return ROLE_PERMISSIONS[role];
  if (grantedKeys && grantedKeys.length > 0) return permissionsFromKeys(grantedKeys);
  return READ_ONLY;
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsOfRole(role).includes(permission);
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

/**
 * Check if a role is admin (Manager or Assistant Manager)
 */
export function isAdmin(role: Role): boolean {
  return role === 'MANAGER' || role === 'ASSISTANT_MANAGER';
}

/**
 * Check if a role is manager only
 */
export function isManager(role: Role): boolean {
  return role === 'MANAGER';
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: Role): Permission[] {
  return permissionsOfRole(role);
}

/**
 * Compare role hierarchy (returns true if role1 >= role2).
 * An unrecognised (custom) role ranks at the member floor — see
 * `permissionsOfRole`; an undefined lookup previously made every comparison NaN,
 * which is false in BOTH directions.
 */
export function hasHigherOrEqualRole(role1: Role, role2: Role): boolean {
  const rank = (r: Role) => (isBuiltInRole(r) ? ROLE_HIERARCHY[r] : ROLE_HIERARCHY.MEMBER);
  return rank(role1) >= rank(role2);
}
