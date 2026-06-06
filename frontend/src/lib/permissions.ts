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
  SOFTWARE_DEVELOPER_INTERN: 40,
  CONTENT_ENGINEER: 40,
  MEMBER: 20,
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

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

  // Analytics permissions
  VIEW_ANALYTICS = 'VIEW_ANALYTICS',
  VIEW_TEAM_ANALYTICS = 'VIEW_TEAM_ANALYTICS',
}

// Permission matrix: Role -> Permissions
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
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

    Permission.VIEW_ANALYTICS,
    Permission.VIEW_TEAM_ANALYTICS,
  ],

  ASSISTANT_MANAGER: [
    // Most permissions except workspace deletion and team management
    Permission.VIEW_PROJECTS,
    Permission.CREATE_PROJECT,
    Permission.EDIT_PROJECT,
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

    Permission.VIEW_SPRINTS,
    Permission.CREATE_SPRINT,
    Permission.EDIT_SPRINT,
    Permission.DELETE_SPRINT,

    Permission.VIEW_TEAM,
    // Note: INVITE_MEMBER, EDIT_MEMBER, REMOVE_MEMBER removed - only MANAGER can manage team

    Permission.VIEW_WORKSPACE,
    Permission.EDIT_WORKSPACE,

    Permission.REQUEST_LEAVE,
    Permission.APPROVE_LEAVE,
    Permission.REJECT_LEAVE,

    Permission.VIEW_ANALYTICS,
    Permission.VIEW_TEAM_ANALYTICS,
  ],

  SOFTWARE_DEVELOPER: [
    // View and create, but limited edit/delete
    Permission.VIEW_PROJECTS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,
    Permission.ASSIGN_TASK,

    Permission.VIEW_EPICS,

    Permission.VIEW_SPRINTS,

    Permission.VIEW_TEAM,

    Permission.VIEW_WORKSPACE,

    Permission.REQUEST_LEAVE,

    Permission.VIEW_ANALYTICS,
  ],

  TESTER: [
    // Similar to developer
    Permission.VIEW_PROJECTS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,
    Permission.ASSIGN_TASK,

    Permission.VIEW_EPICS,

    Permission.VIEW_SPRINTS,

    Permission.VIEW_TEAM,

    Permission.VIEW_WORKSPACE,

    Permission.REQUEST_LEAVE,

    Permission.VIEW_ANALYTICS,
  ],

  SOFTWARE_DEVELOPER_INTERN: [
    // Limited permissions
    Permission.VIEW_PROJECTS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,

    Permission.VIEW_EPICS,

    Permission.VIEW_SPRINTS,

    Permission.VIEW_TEAM,

    Permission.VIEW_WORKSPACE,

    Permission.REQUEST_LEAVE,

    Permission.VIEW_ANALYTICS,
  ],

  CONTENT_ENGINEER: [
    // Similar to intern
    Permission.VIEW_PROJECTS,

    Permission.VIEW_TASKS,
    Permission.CREATE_TASK,
    Permission.EDIT_OWN_TASK,

    Permission.VIEW_EPICS,

    Permission.VIEW_SPRINTS,

    Permission.VIEW_TEAM,

    Permission.VIEW_WORKSPACE,

    Permission.REQUEST_LEAVE,

    Permission.VIEW_ANALYTICS,
  ],

  MEMBER: [
    // Basic permissions
    Permission.VIEW_PROJECTS,
    Permission.VIEW_TASKS,
    Permission.VIEW_EPICS,
    Permission.VIEW_SPRINTS,
    Permission.VIEW_TEAM,
    Permission.VIEW_WORKSPACE,
    Permission.REQUEST_LEAVE,
    Permission.VIEW_ANALYTICS,
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
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
  return ROLE_PERMISSIONS[role];
}

/**
 * Compare role hierarchy (returns true if role1 >= role2)
 */
export function hasHigherOrEqualRole(role1: Role, role2: Role): boolean {
  return ROLE_HIERARCHY[role1] >= ROLE_HIERARCHY[role2];
}
