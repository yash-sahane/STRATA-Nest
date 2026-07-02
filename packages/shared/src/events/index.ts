/**
 * Base domain-event contract (ADR-0006, ADR-0012). Events carry BUSINESS
 * meaning — there is no generic `*Updated` (review #5). Concrete events (e.g.
 * `TaskAssigned`, `LeaveApproved`) are defined alongside their owning module
 * and re-exported here as the migration progresses (arch §11). Phase 0 ships
 * only the base contract — no domain events yet.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Stable business event name, e.g. "task.assigned". */
  readonly name: string;
  /** Owning workspace, used to route to authorized realtime rooms (ADR-0006). */
  readonly workspaceId?: string;
  readonly payload: TPayload;
  /** ISO-8601 timestamp, emitted AFTER commit (arch §4 side-effect rule). */
  readonly occurredAt: string;
}

// --- Phase 2: Workspace domain events (business-meaningful, ADR-0006) --------
export const WorkspaceEvents = {
  MemberAdded: 'workspace.member.added',
  MemberRoleChanged: 'workspace.member.role_changed',
  MemberRemoved: 'workspace.member.removed',
  InvitationAccepted: 'workspace.invitation.accepted',
  JoinRequestApproved: 'workspace.join_request.approved',
  JoinRequestRejected: 'workspace.join_request.rejected',
} as const;

export interface WorkspaceMemberAddedPayload {
  workspaceId: string;
  userId: string;
  role: string;
  via: 'invite' | 'join' | 'direct';
}
export interface WorkspaceMemberRoleChangedPayload {
  workspaceId: string;
  userId: string;
  role: string;
  previousRole: string;
}
export interface JoinRequestHandledPayload {
  workspaceId: string;
  userId: string;
  requestId: string;
}

// --- Phase 5: Planning domain events -----------------------------------------
export const PlanningEvents = {
  SprintStarted: 'sprint.started',
  SprintCompleted: 'sprint.completed',
} as const;

export interface SprintLifecyclePayload {
  workspaceId: string;
  projectId: string;
  sprintId: string;
}

// --- Phase 8: HR domain events -----------------------------------------------
export const HrEvents = {
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
}
export interface TimeEntryDecisionPayload {
  workspaceId: string;
  userId: string;
  timeEntryId: string;
}

// --- Phase 9: Notification / Activity engines --------------------------------
// Phase 9 does not introduce NEW domain events — its subscribers (Notification +
// Audit) consume the business events already emitted by Phases 2–8 above and
// fan them out to per-user notifications + an append-only audit log (ADR-0011).
// A notification's `type` is derived from the source event name; NotifiableEvent
// is the set of events that currently produce a per-user notification (all carry
// a `userId` recipient). More join the set as later phases emit events.
export const NotifiableEvent = {
  [WorkspaceEvents.MemberAdded]: 'workspace_member_added',
  [WorkspaceEvents.MemberRoleChanged]: 'workspace_role_changed',
  [WorkspaceEvents.InvitationAccepted]: 'invitation_accepted',
  [WorkspaceEvents.JoinRequestApproved]: 'join_request_approved',
  [WorkspaceEvents.JoinRequestRejected]: 'join_request_rejected',
  [HrEvents.LeaveApproved]: 'leave_approved',
  [HrEvents.LeaveRejected]: 'leave_rejected',
  [HrEvents.TimeEntryApproved]: 'time_entry_approved',
  [HrEvents.TimeEntryRejected]: 'time_entry_rejected',
} as const;
