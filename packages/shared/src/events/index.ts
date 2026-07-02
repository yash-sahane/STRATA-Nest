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
