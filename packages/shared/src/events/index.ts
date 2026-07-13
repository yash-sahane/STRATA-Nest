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

// --- Planning domain events --------------------------------------------------
export const PlanningEvents = {
  SprintStarted: 'sprint.started',
  SprintCompleted: 'sprint.completed',
} as const;

export interface SprintLifecyclePayload {
  workspaceId: string;
  projectId: string;
  sprintId: string;
}

// --- HR domain events --------------------------------------------------------
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

// --- Notification / Activity engines -----------------------------------------
// The Notification and Audit subscribers introduce no NEW domain events — they
// consume the business events emitted above and fan them out to per-user
// notifications + an append-only audit log. A notification's `type` is derived
// from the source event name; NotifiableEvent is the set of events that produce
// a per-user notification (all carry a `userId` recipient).
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
