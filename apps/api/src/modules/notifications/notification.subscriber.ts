import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HrEvents,
  NotifiableEvent,
  WorkspaceEvents,
  type DomainEvent,
  type JoinRequestHandledPayload,
  type LeaveDecisionPayload,
  type TimeEntryDecisionPayload,
  type WorkspaceMemberAddedPayload,
  type WorkspaceMemberRoleChangedPayload,
} from '@strata/shared';
import { NotificationsService, type NotificationInput } from './notifications.service';

/**
 * Server-guaranteed notifications. Listens to the business events emitted across
 * the app and creates a per-user Notification (+ in_app delivery) for each, so
 * clients don't have to create their own. Runs AFTER commit (events are emitted
 * post-commit) and never throws back into the originating request: a delivery
 * failure is logged, not propagated.
 */
@Injectable()
export class NotificationSubscriber {
  private readonly logger = new Logger('NotificationSubscriber');

  constructor(private readonly notifications: NotificationsService) {}

  private async deliver(input: NotificationInput): Promise<void> {
    try {
      await this.notifications.deliver(input);
    } catch (err) {
      this.logger.warn(`notification delivery failed (${input.type}): ${(err as Error).message}`);
    }
  }

  @OnEvent(WorkspaceEvents.MemberAdded)
  onMemberAdded(e: DomainEvent<WorkspaceMemberAddedPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.MemberAdded],
      title: 'Added to workspace',
      message: `You were added to a workspace as ${e.payload.role}.`,
      relatedEntityId: e.payload.workspaceId,
      relatedEntityType: 'workspace',
    });
  }

  @OnEvent(WorkspaceEvents.MemberRoleChanged)
  onRoleChanged(e: DomainEvent<WorkspaceMemberRoleChangedPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.MemberRoleChanged],
      title: 'Role updated',
      message: `Your role changed from ${e.payload.previousRole} to ${e.payload.role}.`,
      relatedEntityId: e.payload.workspaceId,
      relatedEntityType: 'workspace',
    });
  }

  @OnEvent(WorkspaceEvents.InvitationAccepted)
  onInvitationAccepted(e: DomainEvent<{ workspaceId: string; userId: string }>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.InvitationAccepted],
      title: 'Invitation accepted',
      message: 'You joined a workspace via invitation.',
      relatedEntityId: e.payload.workspaceId,
      relatedEntityType: 'workspace',
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestApproved)
  onJoinApproved(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.JoinRequestApproved],
      title: 'Join request approved',
      message: 'Your request to join the workspace was approved.',
      relatedEntityId: e.payload.requestId,
      relatedEntityType: 'join_request',
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  onJoinRejected(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.JoinRequestRejected],
      title: 'Join request rejected',
      message: 'Your request to join the workspace was rejected.',
      relatedEntityId: e.payload.requestId,
      relatedEntityType: 'join_request',
    });
  }

  @OnEvent(HrEvents.LeaveApproved)
  onLeaveApproved(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[HrEvents.LeaveApproved],
      title: 'Leave approved',
      message: `Your ${e.payload.type} leave (${e.payload.daysCount} day(s)) was approved.`,
      relatedEntityId: e.payload.leaveRequestId,
      relatedEntityType: 'leave_request',
    });
  }

  @OnEvent(HrEvents.LeaveRejected)
  onLeaveRejected(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[HrEvents.LeaveRejected],
      title: 'Leave rejected',
      message: `Your ${e.payload.type} leave request was rejected.`,
      relatedEntityId: e.payload.leaveRequestId,
      relatedEntityType: 'leave_request',
    });
  }

  @OnEvent(HrEvents.TimeEntryApproved)
  onTimeApproved(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[HrEvents.TimeEntryApproved],
      title: 'Time entry approved',
      message: 'Your time entry was approved.',
      relatedEntityId: e.payload.timeEntryId,
      relatedEntityType: 'time_entry',
    });
  }

  @OnEvent(HrEvents.TimeEntryRejected)
  onTimeRejected(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[HrEvents.TimeEntryRejected],
      title: 'Time entry rejected',
      message: 'Your time entry was rejected.',
      relatedEntityId: e.payload.timeEntryId,
      relatedEntityType: 'time_entry',
    });
  }
}
