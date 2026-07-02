/**
 * Prisma model name → frontend collection slug (the REALTIME_COLLECTION mapping,
 * A§7). Only models that were realtime-broadcast in Django appear here; `User`
 * and the authz.* tables are intentionally excluded.
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
  Notification: 'notifications',
  ActivityLog: 'activity_logs',
  SavedSearch: 'saved_searches',
};
