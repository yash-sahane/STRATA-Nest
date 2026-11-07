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
  JoinRequest: 'join_requests',
  Project: 'projects',
  ClientRequirement: 'client_requirements',
  FunctionalRequirement: 'functional_requirements',
  Epic: 'epics',
  Sprint: 'sprints',
  Task: 'tasks',
  TaskComment: 'task_comments',
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
  UploadedFile: 'files',
  GitHubIntegration: 'github_integrations',
  GitLabIntegration: 'gitlab_integrations',
  DiscordIntegration: 'discord_integrations',
  GitCommit: 'git_commits',
};

/**
 * Collections whose rows are addressed to ONE user. Workspace membership is not
 * enough to receive their frames — the row carries private content (a
 * notification's title/message, e.g. a leave rejection reason), so a frame must
 * only reach the recipient's own sockets. See `RealtimeService.isAddressedTo`.
 */
export const USER_SCOPED_COLLECTIONS: ReadonlySet<string> = new Set([
  'notifications',
  // A running timer is its owner's alone. Its frame reached every connected
  // socket (the row had no workspace to filter by), so anybody starting a timer
  // anywhere made every user's header refetch theirs.
  'active_timers',
]);

/**
 * Collections whose REST reads are NARROWER than workspace membership: gated on
 * a permission (`invite:manage`, `join:manage`) or on owning the row (your own
 * attendance, leave, balance and time entries unless you hold the approve
 * permission).
 *
 * A frame reaches every member of the workspace subscribed to the channel, and
 * subscription is not authorised per channel. Carrying the row therefore handed
 * a read-only member exactly what the REST route refuses them: a colleague's
 * leave reason, check-in times and billable rate, and an invite code — the whole
 * secret, usable by any account — the moment a manager minted it.
 *
 * For these the frame carries the row id and nothing else. Every client already
 * treats a frame as "something changed, refetch", and the refetch goes through
 * the route that applies the real rule.
 */
export const ID_ONLY_COLLECTIONS: ReadonlySet<string> = new Set([
  'invite_codes',
  'join_requests',
  'attendance',
  'leave_requests',
  'leave_balances',
  'time_entries',
  'active_timers',
  // `size` is a BigInt, which JSON cannot carry: serialising the full row threw
  // inside the write hook and the frame was never sent at all.
  'files',
  // Credentials. The raw integration row holds the Discord webhook URL in
  // plaintext and the GitHub/GitLab token and webhook secret as ciphertext —
  // fields the REST mappers never return. Every create, edit and "Test
  // connection" (a row update) broadcast them to any member subscribed to the
  // channel, and subscribing is not authorised per channel: a read-only member
  // could lift the webhook URL from devtools and post into the team's Discord.
  'github_integrations',
  'gitlab_integrations',
  'discord_integrations',
  // The REST read narrows leave and time audit rows to their subject and the
  // approvers (ActivityLogsService.readScope); the frame carried the row —
  // "leave rejected", whose, by whom — to every member with /activity open.
  'activity_logs',
]);

/**
 * Models whose rows carry no `workspaceId`, and how to find the workspace a row
 * belongs to. Without one a frame cannot be filtered by membership and went to
 * EVERY connected socket — a comment anywhere refetched every open comment
 * panel in every workspace.
 */
export const WORKSPACE_VIA: Readonly<Record<string, { parent: 'task' | 'project' | 'self'; key: string }>> = {
  TaskComment: { parent: 'task', key: 'taskId' },
  GitCommit: { parent: 'project', key: 'projectId' },
  GitHubIntegration: { parent: 'project', key: 'projectId' },
  GitLabIntegration: { parent: 'project', key: 'projectId' },
  DiscordIntegration: { parent: 'project', key: 'projectId' },
  Workspace: { parent: 'self', key: 'id' },
};
