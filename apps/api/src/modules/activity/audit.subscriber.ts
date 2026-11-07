import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HrEvents,
  PlanningEvents,
  WorkspaceEvents,
  type DomainEvent,
  type JoinRequestHandledPayload,
  type LeaveDecisionPayload,
  type SprintLifecyclePayload,
  type TimeEntryDecisionPayload,
  type WorkspaceMemberAddedPayload,
  type WorkspaceMemberRemovedPayload,
  type WorkspaceMemberRoleChangedPayload,
  type WorkspaceMemberStatusChangedPayload,
} from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import { ActivityLogsService, type AuditInput } from './activity.services';

/**
 * Append-only audit. Writes an ActivityLog row for each business event
 * (post-commit). Best-effort — a failed audit is logged, never propagated
 * back into the originating request. `action` is the event name.
 *
 * The row's `userId` is who DID it, as on every other row of the trail; the
 * person it happened to is `metadata.subjectId`, with their name as the label.
 * Rows were credited to the subject, so "Asha — member added" read as Asha
 * having added somebody, and an approver's refusal read as the requester's.
 */
@Injectable()
export class AuditSubscriber {
  private readonly logger = new Logger('AuditSubscriber');

  constructor(
    private readonly activity: ActivityLogsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Who it happened to: their id, and their name for the feed's label. */
  private async subject(userId: string): Promise<Record<string, unknown>> {
    const person = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { name: true, email: true } })
      .catch(() => null);
    const label = person?.name || person?.email;
    return { subjectId: userId, ...(label ? { label } : {}) };
  }

  private async record(input: AuditInput): Promise<void> {
    try {
      await this.activity.record(input);
    } catch (err) {
      this.logger.warn(`audit write failed (${input.action}): ${(err as Error).message}`);
    }
  }

  @OnEvent(WorkspaceEvents.MemberAdded)
  async onMemberAdded(e: DomainEvent<WorkspaceMemberAddedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.MemberAdded,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      metadata: { ...(await this.subject(e.payload.userId)), role: e.payload.role, via: e.payload.via },
    });
  }

  @OnEvent(WorkspaceEvents.MemberRoleChanged)
  async onRoleChanged(e: DomainEvent<WorkspaceMemberRoleChangedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.MemberRoleChanged,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      changes: { role: [e.payload.previousRole, e.payload.role] },
      metadata: await this.subject(e.payload.userId),
    });
  }

  /** Access switched off, or back on: as much a decision about somebody as a role change, and it left no trace. */
  @OnEvent(WorkspaceEvents.MemberStatusChanged)
  async onStatusChanged(e: DomainEvent<WorkspaceMemberStatusChangedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.MemberStatusChanged,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      changes: { status: [e.payload.previousStatus, e.payload.status] },
      metadata: await this.subject(e.payload.userId),
    });
  }

  /** Emitted by WorkspaceMembersService but previously unhandled anywhere, so
   *  removing someone from a workspace left no trace at all. There is
   *  deliberately no notification counterpart: the removed member has just lost
   *  access to the workspace the notification would be scoped to. */
  @OnEvent(WorkspaceEvents.MemberRemoved)
  async onMemberRemoved(e: DomainEvent<WorkspaceMemberRemovedPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.MemberRemoved,
      entityType: 'workspace_member',
      entityId: e.payload.userId,
      metadata: { ...(await this.subject(e.payload.userId)), role: e.payload.role, via: e.payload.via },
    });
  }

  @OnEvent(PlanningEvents.SprintStarted)
  onSprintStarted(e: DomainEvent<SprintLifecyclePayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId ?? '',
      action: PlanningEvents.SprintStarted,
      entityType: 'sprint',
      entityId: e.payload.sprintId,
      metadata: { projectId: e.payload.projectId },
    });
  }

  /** Sprint completion runs in its own service, so no generic `sprint.updated`
   *  row covers it — without this the milestone was never recorded. */
  @OnEvent(PlanningEvents.SprintCompleted)
  onSprintCompleted(e: DomainEvent<SprintLifecyclePayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId ?? '',
      action: PlanningEvents.SprintCompleted,
      entityType: 'sprint',
      entityId: e.payload.sprintId,
      metadata: { projectId: e.payload.projectId },
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestApproved)
  async onJoinApproved(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.JoinRequestApproved,
      entityType: 'join_request',
      entityId: e.payload.requestId,
      metadata: await this.subject(e.payload.userId),
    });
  }

  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  async onJoinRejected(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.actorId || e.payload.userId,
      action: WorkspaceEvents.JoinRequestRejected,
      entityType: 'join_request',
      entityId: e.payload.requestId,
      metadata: await this.subject(e.payload.userId),
    });
  }

  @OnEvent(HrEvents.LeaveApproved)
  onLeaveApproved(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.approverId || e.payload.userId,
      action: HrEvents.LeaveApproved,
      entityType: 'leave_request',
      entityId: e.payload.leaveRequestId,
      // No leave type and no day count — and the row itself is read only by the
      // person and the workspace's leave approvers (ActivityLogsService.readScope).
      metadata: { subjectId: e.payload.userId },
    });
  }

  @OnEvent(HrEvents.LeaveRejected)
  onLeaveRejected(e: DomainEvent<LeaveDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.approverId || e.payload.userId,
      action: HrEvents.LeaveRejected,
      entityType: 'leave_request',
      entityId: e.payload.leaveRequestId,
      metadata: { subjectId: e.payload.userId },
    });
  }

  @OnEvent(HrEvents.TimeEntryApproved)
  onTimeApproved(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.approverId || e.payload.userId,
      action: HrEvents.TimeEntryApproved,
      entityType: 'time_entry',
      entityId: e.payload.timeEntryId,
      metadata: { subjectId: e.payload.userId },
    });
  }

  @OnEvent(HrEvents.TimeEntryRejected)
  onTimeRejected(e: DomainEvent<TimeEntryDecisionPayload>): Promise<void> {
    return this.record({
      workspaceId: e.payload.workspaceId,
      userId: e.payload.approverId || e.payload.userId,
      action: HrEvents.TimeEntryRejected,
      entityType: 'time_entry',
      entityId: e.payload.timeEntryId,
      metadata: { subjectId: e.payload.userId },
    });
  }
}
