import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HrEvents,
  NotifiableEvent,
  WorkspaceEvents,
  type DomainEvent,
  type JoinRequestCreatedPayload,
  type JoinRequestHandledPayload,
  type LeaveDecisionPayload,
  type TimeEntryDecisionPayload,
  type WorkspaceMemberAddedPayload,
  type WorkspaceMemberRoleChangedPayload,
} from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import { Permission, isBuiltInRole } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { NotificationsService, type NotificationInput } from './notifications.service';

/** MANAGER -> "Manager", SOFTWARE_DEVELOPER -> "Software Developer". A custom
 *  role is somebody's own wording and is left as they wrote it. */
/** CASUAL -> "casual", SICK -> "sick", HALF_DAY -> "half-day". */
function leaveLabel(type: string): string {
  return String(type ?? '').toLowerCase().replace(/_/g, '-');
}

const days = (n: number): string => (n === 1 ? '1 day' : n === 0.5 ? 'half a day' : `${n} days`);

function roleLabel(role: string): string {
  if (!isBuiltInRole(role)) return role;
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  /**
   * Notifications are listed across every workspace a person belongs to, so
   * "a workspace" says nothing: name it. Falls back to the generic wording
   * rather than failing a notification over a lookup.
   */
  private async workspaceName(workspaceId: string): Promise<string> {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true },
      });
      return workspace?.name ? `"${workspace.name}"` : 'a workspace';
    } catch {
      return 'a workspace';
    }
  }

  private async deliver(input: NotificationInput): Promise<void> {
    try {
      await this.notifications.deliver(input);
    } catch (err) {
      this.logger.warn(`notification delivery failed (${input.type}): ${(err as Error).message}`);
    }
  }

  @OnEvent(WorkspaceEvents.MemberAdded)
  async onMemberAdded(e: DomainEvent<WorkspaceMemberAddedPayload>): Promise<void> {
    // Told only when somebody ELSE added them. Whoever made the workspace, or
    // redeemed a code, did it themselves; an approved request is told by its
    // own notice — this one came on top of it, saying the same thing twice.
    if (e.payload.via !== 'direct') return;
    const workspace = await this.workspaceName(e.payload.workspaceId);
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.MemberAdded],
      title: 'Added to workspace',
      message: `You were added to ${workspace} as ${roleLabel(e.payload.role)}.`,
      relatedEntityId: e.payload.workspaceId,
      relatedEntityType: 'workspace',
    });
  }

  @OnEvent(WorkspaceEvents.MemberRoleChanged)
  async onRoleChanged(e: DomainEvent<WorkspaceMemberRoleChangedPayload>): Promise<void> {
    const workspace = await this.workspaceName(e.payload.workspaceId);
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.MemberRoleChanged],
      title: 'Role updated',
      message: `Your role in ${workspace} changed from ${roleLabel(e.payload.previousRole)} to ${roleLabel(e.payload.role)}.`,
      relatedEntityId: e.payload.workspaceId,
      relatedEntityType: 'workspace',
    });
  }

  /**
   * Somebody asked to join: tell the people who can decide it.
   *
   * Nothing did. A request sat in Team > Join Requests until a manager happened
   * to open that tab, and the requester sat on a "no workspace yet" screen
   * meanwhile. One notification per holder of `join:manage`, each honouring that
   * person's own opt-out.
   */
  @OnEvent(WorkspaceEvents.JoinRequestCreated)
  async onJoinRequested(e: DomainEvent<JoinRequestCreatedPayload>): Promise<void> {
    let reviewers: string[] = [];
    try {
      reviewers = await this.access.membersHolding(e.payload.workspaceId, Permission.JoinManage);
    } catch (err) {
      this.logger.warn(`could not resolve join-request reviewers: ${(err as Error).message}`);
    }
    await Promise.all(
      reviewers.map((userId) =>
        this.deliver({
          workspaceId: e.payload.workspaceId,
          userId,
          type: NotifiableEvent[WorkspaceEvents.JoinRequestCreated],
          title: 'New join request',
          message: `${e.payload.requesterName} asked to join "${e.payload.workspaceName}".`,
          relatedEntityId: e.payload.requestId,
          relatedEntityType: 'join_request',
        }),
      ),
    );
  }

  @OnEvent(WorkspaceEvents.JoinRequestApproved)
  async onJoinApproved(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    const workspace = await this.workspaceName(e.payload.workspaceId);
    // The one notice for being let in, so it carries what the "added" notice
    // used to: the role they hold.
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: e.payload.workspaceId, userId: e.payload.userId },
      select: { role: true },
    });
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.JoinRequestApproved],
      title: 'Join request approved',
      message: membership
        ? `Your request to join ${workspace} was approved. You are in as ${roleLabel(membership.role)}.`
        : `Your request to join ${workspace} was approved.`,
      relatedEntityId: e.payload.requestId,
      relatedEntityType: 'join_request',
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  async onJoinRejected(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    const workspace = await this.workspaceName(e.payload.workspaceId);
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[WorkspaceEvents.JoinRequestRejected],
      title: 'Join request declined',
      message: `Your request to join ${workspace} was declined.`,
      relatedEntityId: e.payload.requestId,
      relatedEntityType: 'join_request',
    });
  }

  @OnEvent(HrEvents.LeaveApproved)
  async onLeaveApproved(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    // The only approver approving their own: they know.
    if (e.payload.approverId && e.payload.approverId === e.payload.userId) return;
    return this.deliver({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.userId,
      type: NotifiableEvent[HrEvents.LeaveApproved],
      title: 'Leave approved',
      message: `Your ${leaveLabel(e.payload.type)} leave (${days(e.payload.daysCount)}) was approved.`,
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
      message: e.payload.reason
        ? `Your ${leaveLabel(e.payload.type)} leave request was rejected: ${e.payload.reason}`
        : `Your ${leaveLabel(e.payload.type)} leave request was rejected.`,
      relatedEntityId: e.payload.leaveRequestId,
      relatedEntityType: 'leave_request',
    });
  }

  @OnEvent(HrEvents.TimeEntryApproved)
  async onTimeApproved(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    if (e.payload.approverId && e.payload.approverId === e.payload.userId) return;
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
      message: e.payload.reason
        ? `Your time entry was rejected: ${e.payload.reason}`
        : 'Your time entry was rejected.',
      relatedEntityId: e.payload.timeEntryId,
      relatedEntityType: 'time_entry',
    });
  }
}
