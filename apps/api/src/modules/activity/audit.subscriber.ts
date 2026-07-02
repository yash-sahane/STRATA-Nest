import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HrEvents,
  WorkspaceEvents,
  type DomainEvent,
  type JoinRequestHandledPayload,
  type LeaveDecisionPayload,
  type TimeEntryDecisionPayload,
  type WorkspaceMemberAddedPayload,
  type WorkspaceMemberRoleChangedPayload,
} from '@lt/shared';
import { ActivityLogsService, type AuditInput } from './activity.services';

/**
 * [NEW, D9] Append-only audit. Writes an ActivityLog row for each business
 * event (post-commit). Best-effort — a failed audit is logged, never propagated
 * back into the originating request. `action` is the event name; the actor is
 * the event's subject `userId` until events carry an explicit actorId.
 */
@Injectable()
export class AuditSubscriber {
  private readonly logger = new Logger('AuditSubscriber');

  constructor(private readonly activity: ActivityLogsService) {}

  private async record(input: AuditInput): Promise<void> {
    try {
      await this.activity.record(input);
    } catch (err) {
      this.logger.warn(`audit write failed (${input.action}): ${(err as Error).message}`);
    }
  }

  @OnEvent(WorkspaceEvents.MemberAdded)
  onMemberAdded(e: DomainEvent<WorkspaceMemberAddedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: WorkspaceEvents.MemberAdded,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      metadata: { role: e.payload.role, via: e.payload.via },
    });
  }

  @OnEvent(WorkspaceEvents.MemberRoleChanged)
  onRoleChanged(e: DomainEvent<WorkspaceMemberRoleChangedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: WorkspaceEvents.MemberRoleChanged,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      changes: { role: [e.payload.previousRole, e.payload.role] },
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestApproved)
  onJoinApproved(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: WorkspaceEvents.JoinRequestApproved,
      entityType: 'join_request',
      entityId: e.payload.requestId,
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  onJoinRejected(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: WorkspaceEvents.JoinRequestRejected,
      entityType: 'join_request',
      entityId: e.payload.requestId,
    });
  }

  @OnEvent(HrEvents.LeaveApproved)
  onLeaveApproved(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: HrEvents.LeaveApproved,
      entityType: 'leave_request',
      entityId: e.payload.leaveRequestId,
      metadata: { type: e.payload.type, daysCount: e.payload.daysCount },
    });
  }

  @OnEvent(HrEvents.LeaveRejected)
  onLeaveRejected(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: HrEvents.LeaveRejected,
      entityType: 'leave_request',
      entityId: e.payload.leaveRequestId,
      metadata: { type: e.payload.type },
    });
  }

  @OnEvent(HrEvents.TimeEntryApproved)
  onTimeApproved(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: HrEvents.TimeEntryApproved,
      entityType: 'time_entry',
      entityId: e.payload.timeEntryId,
    });
  }

  @OnEvent(HrEvents.TimeEntryRejected)
  onTimeRejected(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      action: HrEvents.TimeEntryRejected,
      entityType: 'time_entry',
      entityId: e.payload.timeEntryId,
    });
  }
}
