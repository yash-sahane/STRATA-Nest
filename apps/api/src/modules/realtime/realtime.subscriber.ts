import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AuthEvents,
  PlanningEvents,
  WorkspaceEvents,
  type DomainEvent,
  type SessionsRevokedPayload,
  type JoinRequestHandledPayload,
  type SprintLifecyclePayload,
  type WorkspaceMemberAddedPayload,
} from '@strata/shared';
import { RealtimeService } from './realtime.service';

/**
 * Bridges business domain events onto realtime channels.
 * Supplementary to the CRUD write hook — gives clients explicit business-event
 * signals for workflows that don't map to a single watched CRUD.
 */
@Injectable()
export class RealtimeSubscriber {
  constructor(private readonly realtime: RealtimeService) {}

  @OnEvent(WorkspaceEvents.MemberAdded)
  onMemberAdded(e: DomainEvent<WorkspaceMemberAddedPayload>): void {
    this.realtime.emitEvent('workspace_members', e.name, e.payload.userId, e.payload.workspaceId, {
      ...e.payload,
    });
  }

  /**
   * Join requests are read by `join:manage` holders and their author only, so
   * the frame carries the id and nothing else (ID_ONLY_COLLECTIONS) — it used
   * to name the requester to every member subscribed to the channel.
   */
  @OnEvent(WorkspaceEvents.JoinRequestApproved)
  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  onJoinHandled(e: DomainEvent<JoinRequestHandledPayload>): void {
    this.realtime.emitEvent('join_requests', e.name, e.payload.requestId, e.payload.workspaceId, {
      id: e.payload.requestId,
    });
  }

  @OnEvent(AuthEvents.SessionsRevoked)
  onSessionsRevoked(e: DomainEvent<SessionsRevokedPayload>): void {
    this.realtime.disconnectUser(e.payload.userId);
  }

  @OnEvent(PlanningEvents.SprintStarted)
  onSprintStarted(e: DomainEvent<SprintLifecyclePayload>): void {
    this.realtime.emitEvent('sprints', e.name, e.payload.sprintId, e.payload.workspaceId, {
      ...e.payload,
    });
  }

  @OnEvent(PlanningEvents.SprintCompleted)
  onSprintCompleted(e: DomainEvent<SprintLifecyclePayload>): void {
    this.realtime.emitEvent('sprints', e.name, e.payload.sprintId, e.payload.workspaceId, {
      ...e.payload,
    });
  }
}
