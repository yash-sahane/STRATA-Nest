/**
 * Permission System
 * Defines role hierarchy and permission matrix
 */

/** The seven roles every workspace has. Custom roles are defined per workspace. */
export const BUILT_IN_ROLES = [
  'MANAGER',
  'ASSISTANT_MANAGER',
  'SOFTWARE_DEVELOPER',
  'TESTER',
  'DEVELOPER_INTERN',
  'CONTENT_ENGINEER',
  'MEMBER',
] as const;

export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

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
  // The REVIEW -> DONE transition. Its own entry because the API gates it on
  // `task:write`, not on the `task:update` that lets a delivery role move a card
  // anywhere else: gating it on EDIT_ANY_TASK let a developer drop a card onto
  // Done, watch it move, and then watch the server put it back.
  COMPLETE_TASK = 'COMPLETE_TASK',

  // File permissions. Reading is part of every membership; attaching and
  // deleting take the API's `file:write`.
  UPLOAD_FILE = 'UPLOAD_FILE',

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

/** Whether `role` is one of the seven built-in roles. */
export function isBuiltInRole(role: string): role is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(role);
}

/**
 * The API's permission keys mapped to the coarser actions this module models.
 *
 * The keys are the server's answer (GET /auth/me/access — every membership's
 * effective keys, implied ones included), so this is only a translation: the
 * browser keeps no role matrix of its own. Keys with no UI counterpart (`role:manage`, `invite:manage`,
 * `join:manage`, `hr:read`, `file:read`, `notification:*`, `activity:*`,
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
    // VIEW_TEAM_ANALYTICS rides with planning: Team Performance is the view of
    // the people a planner hands work to. It is a presentation choice, not a
    // read rule — the tasks it is drawn from are every member's to read — so it
    // follows the job it serves rather than an HR permission.
    'planning:write': [
      Permission.CREATE_EPIC,
      Permission.EDIT_EPIC,
      Permission.DELETE_EPIC,
      Permission.CREATE_SPRINT,
      Permission.EDIT_SPRINT,
      Permission.DELETE_SPRINT,
      Permission.VIEW_TEAM_ANALYTICS,
    ],
    'task:read': [Permission.VIEW_TASKS],
    // Split exactly as the API splits it: `task:create` files a new task,
    // `task:write` deletes and signs off (and implies the other two), and
    // changing an existing card is `task:update`. Collapsing them would offer a
    // delivery role a Delete.
    'task:create': [Permission.CREATE_TASK],
    'task:write': [Permission.CREATE_TASK, Permission.DELETE_TASK, Permission.COMPLETE_TASK],
    'task:update': [Permission.EDIT_OWN_TASK, Permission.EDIT_ANY_TASK, Permission.ASSIGN_TASK],
    'file:write': [Permission.UPLOAD_FILE],
    'hr:write': [Permission.REQUEST_LEAVE],
    'leave:approve': [Permission.APPROVE_LEAVE, Permission.REJECT_LEAVE],
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
  // A platform administrator passes every check server-side.
  if (keys.includes('*')) return Object.values(Permission);
  const resolved = new Set<Permission>(MEMBERSHIP_FLOOR);
  for (const key of keys) {
    for (const permission of API_PERMISSION_MAP[key] ?? []) resolved.add(permission);
  }
  return [...resolved];
}
