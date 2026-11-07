/**
 * Base domain-event contract. Events carry BUSINESS meaning — there is no
 * generic `*Updated`. Concrete events (e.g. `TaskAssigned`, `LeaveApproved`)
 * are defined alongside their owning module and re-exported here.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Stable business event name, e.g. "task.assigned". */
  readonly name: string;
  /** Owning workspace, used to route to authorized realtime rooms. */
  readonly workspaceId?: string;
  readonly payload: TPayload;
  /** ISO-8601 timestamp, emitted AFTER the owning transaction commits. */
  readonly occurredAt: string;
}

// --- Workspace domain events (business-meaningful) ---------------------------
export const WorkspaceEvents = {
  MemberAdded: 'workspace.member.added',
  MemberRoleChanged: 'workspace.member.role_changed',
  MemberRemoved: 'workspace.member.removed',
  /** A member's access was switched off (INACTIVE) or back on (ACTIVE). */
  MemberStatusChanged: 'workspace.member.status_changed',
  JoinRequestCreated: 'workspace.join_request.created',
  JoinRequestApproved: 'workspace.join_request.approved',
  JoinRequestRejected: 'workspace.join_request.rejected',
} as const;

export interface WorkspaceMemberAddedPayload {
  workspaceId: string;
  userId: string;
  role: string;
  /** `created`: they made the workspace themselves. `invite`: they redeemed a
   *  code. `join`: their request was approved. `direct`: somebody added them. */
  via: 'invite' | 'join' | 'direct' | 'created';
  /** Who did it: the person themselves for `created`/`invite`, else whoever added or approved them. */
  actorId?: string;
}
/** `via: 'left'` is the member ending their own membership; anything else is
 *  somebody taking them out. */
export interface WorkspaceMemberRemovedPayload {
  workspaceId: string;
  userId: string;
  role: string;
  via: 'direct' | 'left';
  actorId?: string;
}
export interface WorkspaceMemberStatusChangedPayload {
  workspaceId: string;
  userId: string;
  status: string;
  previousStatus: string;
  actorId?: string;
}
export interface WorkspaceMemberRoleChangedPayload {
  workspaceId: string;
  userId: string;
  role: string;
  previousRole: string;
  actorId?: string;
}
export interface JoinRequestHandledPayload {
  workspaceId: string;
  userId: string;
  requestId: string;
  /** Who decided it. */
  actorId?: string;
}
/** Somebody asked to join. `userId` is the REQUESTER; the people to tell are
 *  whoever can decide it, resolved by the subscriber. */
export interface JoinRequestCreatedPayload {
  workspaceId: string;
  userId: string;
  requestId: string;
  requesterName: string;
  workspaceName: string;
}

// --- Auth events -----------------------------------------------------------------
export const AuthEvents = {
  /** Every session of an account was ended: password reset or change, a new
   *  temporary password, deactivation. Whatever is still connected must go. */
  SessionsRevoked: 'auth.sessions_revoked',
} as const;

export interface SessionsRevokedPayload {
  userId: string;
}

// --- Planning domain events --------------------------------------------------
export const PlanningEvents = {
  SprintStarted: 'sprint.started',
  SprintCompleted: 'sprint.completed',
} as const;

export interface SprintLifecyclePayload {
  workspaceId: string;
  projectId: string;
  sprintId: string;
  /** Who performed the transition. Sprint events have no per-user subject the
   *  way the membership and HR events do, so without this the audit trail
   *  recorded the milestone with no author. */
  actorId?: string;
  /** Completion only: everybody who had a task in the sprint as it closed.
   *  Unfinished tasks are rolled out of the sprint by a subscriber to this very
   *  event, after which nothing names the sprint they were in. */
  assigneeIds?: string[];
}

// --- Work events: things one person does that another should be told about ---
export const TaskEvents = {
  Assigned: 'task.assigned',
  StatusChanged: 'task.status_changed',
  PriorityChanged: 'task.priority_changed',
} as const;

interface TaskEventBase {
  workspaceId: string;
  projectId: string;
  taskId: string;
  title: string;
  hierarchyId: string;
  actorId: string;
  actorName: string;
}
/** `assigneeIds` are the people NEWLY assigned by this write, not the whole list. */
export interface TaskAssignedPayload extends TaskEventBase {
  assigneeIds: string[];
}
export interface TaskStatusChangedPayload extends TaskEventBase {
  from: string;
  to: string;
  assigneeIds: string[];
  sprintId: string;
}
export interface TaskPriorityChangedPayload extends TaskEventBase {
  priority: string;
  assigneeIds: string[];
}

export const RequirementEvents = {
  ClientRequirementCreated: 'client_requirement.created',
  EpicCreated: 'epic.created',
  FunctionalRequirementAssigned: 'functional_requirement.assigned',
} as const;

export interface RequirementAnnouncedPayload {
  workspaceId: string;
  projectId: string;
  entityId: string;
  title: string;
  actorId: string;
  actorName: string;
  /** FunctionalRequirementAssigned only: the people newly assigned. */
  assigneeIds?: string[];
}

// --- HR domain events --------------------------------------------------------
export const HrEvents = {
  LeaveRequested: 'leave.requested',
  LeaveApproved: 'leave.approved',
  LeaveRejected: 'leave.rejected',
  TimeEntryApproved: 'time_entry.approved',
  TimeEntryRejected: 'time_entry.rejected',
} as const;

export interface LeaveDecisionPayload {
  workspaceId: string;
  userId: string;
  leaveRequestId: string;
  type: string;
  daysCount: number;
  /** Who decided — the requester themselves when they are the only approver. */
  approverId?: string;
  /** A rejection's reason, as the approver wrote it. */
  reason?: string;
}
/** `userId` is the REQUESTER; the people to tell are whoever can approve. */
export interface LeaveRequestedPayload {
  workspaceId: string;
  userId: string;
  leaveRequestId: string;
  type: string;
  daysCount: number;
  requesterName: string;
}
export interface TimeEntryDecisionPayload {
  workspaceId: string;
  userId: string;
  timeEntryId: string;
  /** Who decided — the owner themselves when they are the only approver. */
  approverId?: string;
  reason?: string;
}

// --- Notification / Activity engines -----------------------------------------
// The Notification and Audit subscribers introduce no NEW domain events — they
// consume the business events emitted above and fan them out to per-user
// notifications + an append-only audit log. A notification's `type` is derived
// from the source event name; NotifiableEvent is the set of events that produce
// a per-user notification (all carry a `userId` recipient).
//
// Written in the same SCREAMING_SNAKE as every other notification. They were
// snake_case until 2026-10 (`leave_approved`), and rows from before then keep
// that spelling — so a reader compares types through normaliseNotificationType.
export const NotifiableEvent = {
  [WorkspaceEvents.MemberAdded]: 'WORKSPACE_MEMBER_ADDED',
  [WorkspaceEvents.MemberRoleChanged]: 'WORKSPACE_ROLE_CHANGED',
  [WorkspaceEvents.JoinRequestCreated]: 'JOIN_REQUEST_RECEIVED',
  [WorkspaceEvents.JoinRequestApproved]: 'JOIN_REQUEST_APPROVED',
  [WorkspaceEvents.JoinRequestRejected]: 'JOIN_REQUEST_REJECTED',
  [WorkspaceEvents.MemberRemoved]: 'WORKSPACE_MEMBER_REMOVED',
  [WorkspaceEvents.MemberStatusChanged]: 'WORKSPACE_ACCESS_CHANGED',
  [HrEvents.LeaveApproved]: 'LEAVE_APPROVED',
  [HrEvents.LeaveRejected]: 'LEAVE_REJECTED',
  [HrEvents.TimeEntryApproved]: 'TIME_ENTRY_APPROVED',
  [HrEvents.TimeEntryRejected]: 'TIME_ENTRY_REJECTED',
} as const;

/**
 * Every type of notification the API writes, and nothing else — the list the
 * senders are typed against, and that the frontend's NotificationType and its
 * preference screen are checked against (apps/api notification-types.spec).
 */
export const NOTIFICATION_TYPES = [
  // Tasks
  'TASK_ASSIGNED',
  'TASK_UNASSIGNED',
  'TASK_STATUS_CHANGED',
  'TASK_PRIORITY_CHANGED',
  'TASK_REVIEW_REQUESTED',
  'TASK_REVIEWED_DONE',
  'TASK_COMMENT_ADDED',
  'TASK_COMMENT_REMOVED',
  'TASK_DEADLINE_REMINDER',
  'TASK_OVERDUE',
  'TASK_DELETED',
  // Requirements and planning
  'REQUIREMENT_CREATED',
  'EPIC_CREATED',
  'FR_ASSIGNED',
  'FR_UNASSIGNED',
  // Sprints
  'SPRINT_STARTED',
  'SPRINT_READY_TO_CLOSE',
  'SPRINT_COMPLETED',
  // Leave, attendance and time
  'LEAVE_REQUESTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_BALANCE_ADJUSTED',
  'ATTENDANCE_CORRECTED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'TIME_ENTRY_REJECTED',
  // Workspace
  'WORKSPACE_MEMBER_ADDED',
  'WORKSPACE_ROLE_CHANGED',
  'WORKSPACE_OWNERSHIP_TRANSFERRED',
  'WORKSPACE_ACCESS_CHANGED',
  'WORKSPACE_MEMBER_REMOVED',
  'JOIN_REQUEST_RECEIVED',
  'JOIN_REQUEST_APPROVED',
  'JOIN_REQUEST_REJECTED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** One spelling for comparing: older rows carry `leave_approved` for LEAVE_APPROVED. */
export function normaliseNotificationType(type: string | null | undefined): string {
  return String(type ?? '').trim().toUpperCase();
}
