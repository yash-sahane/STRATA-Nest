/**
 * Single source of truth for collection slug to REST URL segment mapping.
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
  tasks: 'tasks',
  task_comments: 'task_comments',
  kanban_columns: 'kanban_columns',
  labels: 'labels',
  attendance: 'attendance',
  leave_requests: 'leave_requests',
  leave_balances: 'leave_balances',
  holidays: 'holidays',
  notifications: 'notifications',
  github_integrations: 'github_integrations',
  gitlab_integrations: 'gitlab_integrations',
  discord_integrations: 'discord_integrations',
  git_commits: 'git_commits',
  activity_logs: 'activity_logs',
  time_entries: 'time_entries',
  active_timers: 'active_timers',
  join_requests: 'join_requests',
  email_invitations: 'email_invitations',
  invite_codes: 'invite_codes',
  pending_workspace_access: 'pending_workspace_access',
  retrospectives: 'retrospectives',
  saved_searches: 'saved_searches',
} as const;

export type CollectionKey = keyof typeof COLLECTION_SLUGS;

/**
 * Resolve any resource collection identifier to the canonical API route slug.
 */
export function resolveSlug(input: string): string {
  if (!input) return input;
  // Direct match.
  if (input in COLLECTION_SLUGS) return COLLECTION_SLUGS[input as CollectionKey];
  // Already a slug value (identity).
  const values: string[] = Object.values(COLLECTION_SLUGS);
  if (values.includes(input)) return input;
  return input;
}
