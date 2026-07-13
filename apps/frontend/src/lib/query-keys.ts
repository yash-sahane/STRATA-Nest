/**
 * Centralized query key definitions for React query
 * This ensures consistency across the application and makes refactoring easier
 */

export const QUERY_KEYS = {
    // Workspace-scoped queries (cleared on workspace switch)
    WORKSPACE_SCOPED: {
        PROJECTS: ['projects'],
        PROJECT: ['project'],
        TASKS: ['tasks'],
        TASK: ['task'],
        WORKSPACE_TASKS: ['workspace-tasks'],
        EPICS: ['epics'],
        EPIC: ['epic'],
        SPRINTS: ['sprints'],
        SPRINT: ['sprint'],
        WORKSPACE_SPRINTS: ['workspace-sprints'],
        REQUIREMENTS: ['requirements'],
        FUNCTIONAL_REQUIREMENTS: ['functional-requirements'],
        FUNCTIONAL_REQUIREMENT: ['functional-requirement'],
        CLIENT_REQUIREMENTS: ['client-requirements'],
        CLIENT_REQUIREMENT: ['client-requirement'],
        ATTENDANCE: ['attendance'],
        LEAVE_REQUESTS: ['leave-requests'],
        LEAVE_REQUEST: ['leave-request'],
        NOTIFICATIONS: ['notifications'],
        UNREAD_COUNT: ['unread-count'],
        ANALYTICS: ['analytics'],
        WORKSPACE_ANALYTICS: ['workspace-analytics'],
        TEAM: ['team'],
        WORKSPACE_MEMBERS: ['workspace-members'],
        ACTIVITY: ['activity'],
        ACTIVITY_LOGS: ['activity-logs'],
        COMMENTS: ['comments'],
        TASK_COMMENTS: ['task-comments'],
        TIME_ENTRIES: ['time-entries'],
        ACTIVE_TIMERS: ['active-timers'],
        JOIN_REQUESTS: ['join-requests'],
        INVITATIONS: ['invitations'],
        SAVED_SEARCHES: ['saved-searches'],
        GLOBAL_SEARCH: ['global-search'],
    },

    // User-scoped queries (persist across workspace switches)
    USER_SCOPED: {
        WORKSPACES: ['workspaces'],
        USER_PROFILE: ['user-profile'],
        USER_PREFERENCES: ['user-preferences'],
    },
} as const;

/**
 * Get all workspace-scoped query keys as an array
 */
export function getWorkspaceScopedKeys(): readonly (readonly string[])[] {
    return Object.values(QUERY_KEYS.WORKSPACE_SCOPED);
}
