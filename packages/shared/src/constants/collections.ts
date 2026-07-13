/**
 * Canonical collection slugs — the versioned REST URL segments + realtime channel
 * names the frontend uses (mirrors frontend/src/lib/api/collection-slugs.ts).
 * Routing and realtime rooms key off these.
 */
export const COLLECTION_SLUGS = {
  workspaces: 'workspaces',
  workspace_members: 'workspace_members',
  workspace_roles: 'workspace_roles',
  users: 'users',
  projects: 'projects',
  client_requirements: 'client_requirements',
  functional_requirements: 'functional_requirements',
  epics: 'epics',
  sprints: 'sprints',
  retrospectives: 'retrospectives',
  tasks: 'tasks',
  task_comments: 'task_comments',
  kanban_columns: 'kanban_columns',
  labels: 'labels',
  attendance: 'attendance',
  holidays: 'holidays',
  leave_requests: 'leave_requests',
  leave_balances: 'leave_balances',
  notifications: 'notifications',
  github_integrations: 'github_integrations',
  gitlab_integrations: 'gitlab_integrations',
  discord_integrations: 'discord_integrations',
  git_commits: 'git_commits',
  activity_logs: 'activity_logs',
  saved_searches: 'saved_searches',
  time_entries: 'time_entries',
  active_timers: 'active_timers',
  join_requests: 'join_requests',
  email_invitations: 'email_invitations',
  invite_codes: 'invite_codes',
  pending_workspace_access: 'pending_workspace_access',
  files: 'files',
} as const;

export type CollectionKey = keyof typeof COLLECTION_SLUGS;
