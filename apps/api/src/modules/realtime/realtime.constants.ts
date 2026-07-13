/**
 * Prisma model name → frontend collection slug (the REALTIME_COLLECTION
 * mapping). Only models the frontend needs realtime events for are listed
 * here; `User` and the authz.* tables are intentionally excluded.
 */
export const MODEL_COLLECTION: Record<string, string> = {
  Workspace: 'workspaces',
  WorkspaceMember: 'workspace_members',
  WorkspaceRole: 'workspace_roles',
  InviteCode: 'invite_codes',
  EmailInvitation: 'email_invitations',
  JoinRequest: 'join_requests',
  PendingWorkspaceAccess: 'pending_workspace_access',
  Project: 'projects',
  ClientRequirement: 'client_requirements',
  FunctionalRequirement: 'functional_requirements',
  Epic: 'epics',
  Sprint: 'sprints',
  Retrospective: 'retrospectives',
  Task: 'tasks',
  TaskComment: 'task_comments',
  KanbanColumn: 'kanban_columns',
  Label: 'labels',
  // HR/time collections — must broadcast on every write like every other
  // realtime-enabled model, so they are listed here for the write hook to
  // emit their events.
  Attendance: 'attendance',
  Holiday: 'holidays',
  LeaveRequest: 'leave_requests',
  LeaveBalance: 'leave_balances',
  TimeEntry: 'time_entries',
  ActiveTimer: 'active_timers',
  Notification: 'notifications',
  ActivityLog: 'activity_logs',
  SavedSearch: 'saved_searches',
  UploadedFile: 'files',
  GitHubIntegration: 'github_integrations',
  GitLabIntegration: 'gitlab_integrations',
  DiscordIntegration: 'discord_integrations',
  GitCommit: 'git_commits',
};
