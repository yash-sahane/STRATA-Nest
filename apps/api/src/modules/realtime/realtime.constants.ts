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
 * The only collections whose frames may carry the row itself. Every other
 * collection — including any added to MODEL_COLLECTION later — sends the id and
 * where the record lives (`RealtimeService.announce`), and nothing else.
 *
 * Every client treats a frame as "something changed, refetch", and the refetch
 * goes through the REST route, which applies the real read rule. The row on the
 * wire was therefore only ever a liability, and each time a collection was left
 * off an exclusion list it leaked:
 *  - Reads NARROWER than workspace membership. A frame reaches every member
 *    subscribed to the channel, and subscribing is not authorised per channel.
 *    Invite codes and join requests are gated on `invite:manage` and
 *    `join:manage`; attendance, leave, balances and time entries on owning the
 *    row or holding the approve permission. Their rows handed a read-only member
 *    a colleague's leave reason, check-in times and billable rate, and an invite
 *    code — the whole secret, usable by any account — the moment a manager
 *    minted it.
 *  - Credentials. The raw integration row holds the Discord webhook URL in
 *    plaintext and the GitHub/GitLab token and webhook secret as ciphertext,
 *    fields the REST mappers never return. Every create, edit and "Test
 *    connection" broadcast them, and a read-only member could lift the webhook
 *    URL from devtools and post into the team's Discord.
 *  - Audit rows. The REST read narrows leave and time entries in the log to
 *    their subject and the approvers (ActivityLogsService.readScope); the frame
 *    carried "leave rejected", whose and by whom to everybody with /activity open.
 *  - Rows JSON cannot carry. A file's `size` is a BigInt: serialising the row
 *    threw inside the write hook and the frame was never sent at all.
 *
 * A collection belongs here only when a client reads row data off its frames
 * AND the row is no wider than what every receiver may read over REST.
 */
export const FULL_ROW_COLLECTIONS: ReadonlySet<string> = new Set([
  // The toast for an inbound notification shows its title — the one place the
  // app reads a row off a frame. Its frames reach the recipient alone
  // (USER_SCOPED_COLLECTIONS), and the row has exactly the fields the
  // recipient's own REST read returns.
  'notifications',
]);

/**
 * Collections whose records each belong to one project, and that every member
 * of the workspace may read. Their frames name the project, so a client
 * refetches that project's lists only: the realtime channel is per collection,
 * and a write anywhere in the workspace otherwise refetched every open board of
 * every project. A record never moves between projects (no update DTO accepts
 * `projectId`), so the project a frame names is the only one it can change.
 */
export const PROJECT_SCOPED_COLLECTIONS: ReadonlySet<string> = new Set([
  'tasks',
  'sprints',
  'epics',
  'functional_requirements',
  'client_requirements',
  'files',
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
