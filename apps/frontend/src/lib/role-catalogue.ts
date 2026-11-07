/**
 * The API's permission keys, in words.
 *
 * `lib/permissions.ts` models what the SCREENS gate on, which is coarser than
 * what a role actually stores: a custom `WorkspaceRole.permissions` array holds
 * the API's own keys (`task:update`, `role:manage`, ...), several of which no
 * screen-level permission corresponds to. Anything that reads or writes a role
 * definition — the role editor, and the question "may I hand this role out?" —
 * has to work in those keys, so this is their catalogue.
 *
 * Mirrors apps/api/src/modules/authz/permissions.ts. The API is the enforcing
 * copy: it refuses an unknown key and a grant above the caller's own, so a
 * mismatch here shows as a refused save, never as access.
 */

import { isBuiltInRole, type BuiltInRole } from '@/lib/permissions';

export interface PermissionEntry {
  /** The key as the API stores it. */
  key: string;
  label: string;
  /** What holding it lets somebody do, where the label alone does not say. */
  description?: string;
}

export interface PermissionGroup {
  title: string;
  permissions: PermissionEntry[];
}

/**
 * What every membership holds, whatever its role: every read, plus keeping
 * one's own attendance, leave, time and notifications. The API calls this
 * READ_ONLY and exempts it from the "you can only grant what you hold" rule,
 * because handing it over raises nobody.
 *
 * A custom role is stored WITH these keys. The API resolves a custom role to
 * exactly the array it stores, so one saved without `hr:write` could not check
 * in or ask for leave — which is never what "a role for the QA lead" means.
 */
export const BASELINE_PERMISSIONS: PermissionEntry[] = [
  { key: 'workspace:read', label: 'See the workspace' },
  { key: 'member:read', label: 'See the team' },
  { key: 'project:read', label: 'See projects' },
  { key: 'requirement:read', label: 'See requirements' },
  { key: 'planning:read', label: 'See epics and sprints' },
  { key: 'task:read', label: 'See tasks' },
  { key: 'file:read', label: 'See files' },
  { key: 'integration:read', label: 'See integrations' },
  { key: 'hr:read', label: 'See their own attendance, leave and time' },
  { key: 'hr:write', label: 'Check in, request leave and log time' },
  { key: 'notification:read', label: 'Receive notifications' },
  { key: 'notification:write', label: 'Manage their own notifications' },
  { key: 'activity:read', label: 'See the activity trail' },
];

export const BASELINE_KEYS: ReadonlySet<string> = new Set(BASELINE_PERMISSIONS.map((p) => p.key));

/** Everything a role can be given on top of the baseline, grouped as the app is. */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Tasks',
    permissions: [
      {
        key: 'task:update',
        label: 'Work on tasks',
        description: 'Edit, move, assign and record progress on tasks that already exist.',
      },
      {
        key: 'task:create',
        label: 'File new tasks',
        description: 'A bug found in testing, or a piece of work split off another task.',
      },
      {
        key: 'task:write',
        label: 'Complete and delete tasks',
        description: 'Signing a task off as done, reopening one, and deleting it. Includes filing and working on tasks.',
      },
    ],
  },
  {
    title: 'Requirements and planning',
    permissions: [
      {
        key: 'requirement:write',
        label: 'Manage requirements',
        description: 'Create, edit and delete client and functional requirements.',
      },
      {
        key: 'planning:write',
        label: 'Manage epics and sprints',
        description: 'Create, edit and delete them, and start or complete a sprint.',
      },
    ],
  },
  {
    title: 'Projects',
    permissions: [
      { key: 'project:create', label: 'Create projects' },
      { key: 'project:update', label: 'Edit projects', description: 'Includes project settings.' },
      { key: 'project:delete', label: 'Delete projects' },
    ],
  },
  {
    title: 'Files and integrations',
    permissions: [
      { key: 'file:write', label: 'Upload and delete files' },
      {
        key: 'integration:write',
        label: 'Manage integrations',
        description: 'Connect a repository and change what is connected.',
      },
    ],
  },
  {
    title: 'Attendance, leave and time',
    permissions: [
      {
        key: 'leave:approve',
        label: 'Approve leave and manage attendance',
        description:
          'Approve or reject leave, see and correct the whole team’s attendance, adjust leave balances and keep the holiday calendar.',
      },
      { key: 'time:approve', label: 'Approve time entries' },
    ],
  },
  {
    title: 'People',
    permissions: [
      { key: 'member:invite', label: 'Add members' },
      { key: 'member:update', label: 'Change a member’s role or status' },
      { key: 'member:remove', label: 'Remove members' },
      { key: 'join:manage', label: 'Review requests to join' },
      { key: 'invite:manage', label: 'Manage invite codes' },
      {
        key: 'role:manage',
        label: 'Manage custom roles',
        description: 'Create, change and delete roles — only ever with permissions they hold.',
      },
    ],
  },
  {
    title: 'Workspace',
    permissions: [
      { key: 'workspace:update', label: 'Change workspace settings' },
      { key: 'workspace:delete', label: 'Delete the workspace' },
    ],
  },
];

/** The keys a role editor can switch on or off. */
export const GRANTABLE_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key)
);

/** Every key the API recognises. */
export const ALL_PERMISSION_KEYS: string[] = [...BASELINE_KEYS, ...GRANTABLE_KEYS];
const KNOWN_KEYS: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/**
 * A key that is no use without another one.
 *
 * `task:write` creates, completes and deletes; changing a task that exists is
 * `task:update`. A role with the first and not the second could create a task
 * it then could not edit, so the editor keeps the pair together.
 */
export const PERMISSION_REQUIRES: Record<string, string> = { 'task:write': 'task:update' };

const DELIVERY_KEYS = [...BASELINE_KEYS, 'task:update', 'task:create', 'file:write'];

/** The seven built-in roles, in API keys. Fixed: the API refuses to redefine them. */
export const BUILT_IN_ROLE_KEYS: Record<BuiltInRole, readonly string[]> = {
  MANAGER: ALL_PERMISSION_KEYS,
  ASSISTANT_MANAGER: ALL_PERMISSION_KEYS.filter((key) => key !== 'workspace:delete'),
  SOFTWARE_DEVELOPER: DELIVERY_KEYS,
  DEVELOPER_INTERN: DELIVERY_KEYS,
  TESTER: DELIVERY_KEYS,
  CONTENT_ENGINEER: DELIVERY_KEYS,
  MEMBER: [...BASELINE_KEYS],
};


/**
 * The keys a role name resolves to — term for term what
 * `WorkspaceAccessService.permissionsOfRole` answers: the built-in matrix, else
 * the custom role's own array, else the baseline for a name nothing defines.
 */
export function keysOfRole(role: string, customKeys?: readonly string[] | null): readonly string[] {
  if (isBuiltInRole(role)) return BUILT_IN_ROLE_KEYS[role];
  if (customKeys && customKeys.length > 0) return customKeys;
  return [...BASELINE_KEYS];
}

/**
 * Whether somebody holding `held` may hand out a role carrying `roleKeys`.
 *
 * The API's rule (`assertCanGrantRole`): nobody grants more than they hold; the
 * baseline does not count, because every membership has it; and a stored key the
 * API no longer recognises names no capability, so it is not an escalation.
 */
export function canGrantKeys(held: ReadonlySet<string>, roleKeys: readonly string[]): boolean {
  if (held.has('*')) return true;
  return roleKeys.every((key) => BASELINE_KEYS.has(key) || !KNOWN_KEYS.has(key) || held.has(key));
}

/** One line on what a role amounts to, for a list of roles. */
export function describeRoleKeys(keys: readonly string[]): string {
  const granted = GRANTABLE_KEYS.filter((key) => keys.includes(key));
  if (granted.length === 0) return 'View only';
  if (granted.length === GRANTABLE_KEYS.length) return 'Everything';
  if (granted.length === GRANTABLE_KEYS.length - 1 && !keys.includes('workspace:delete')) {
    return 'Everything except deleting the workspace';
  }
  const labels = PERMISSION_GROUPS.flatMap((g) => g.permissions)
    .filter((p) => granted.includes(p.key))
    .map((p) => p.label);
  const shown = labels.slice(0, 3).join(', ');
  return labels.length > 3 ? `${shown} and ${labels.length - 3} more` : shown;
}
