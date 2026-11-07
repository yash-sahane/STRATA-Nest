import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  HrEvents,
  PlanningEvents,
  RequirementEvents,
  TaskEvents,
  type DomainEvent,
  type LeaveRequestedPayload,
  type RequirementAnnouncedPayload,
  type SprintLifecyclePayload,
  type TaskAssignedPayload,
  type TaskPriorityChangedPayload,
  type TaskStatusChangedPayload,
  NotifiableEvent,
  WorkspaceEvents,
  type JoinRequestHandledPayload,
  type WorkspaceMemberInvitedPayload,
  type WorkspaceMemberRemovedPayload,
  type WorkspaceMemberStatusChangedPayload,
  type NotificationType,
} from '@strata/shared';
import { PrismaService } from '@strata/prisma';
import { Permission, isBuiltInRole } from '../authz/permissions';
import { WorkspaceAccessService } from '../authz/workspace-access.service';
import { MailService } from '../mail/mail.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService, type NotificationInput } from './notifications.service';
import { NOTICE_EVENT, type NoticePayload } from './notice';

/** A work notice, before it is addressed: its type is one of NOTIFICATION_TYPES. */
type Notice = Omit<NotificationInput, 'userId' | 'type'> & { type: NotificationType };

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
};
const titleCase = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;

/** An `assigneeIds` JSON column's user ids: it is JSON, so anything could be in it. */
const userIdsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];

/**
 * The notifications that tell people about each other's WORK: a task assigned or
 * moved, a sprint started or closed, leave asked for, a requirement handed over.
 *
 * Every one of these used to be created by the ACTING user's browser, after its
 * own request came back: it looked up who to tell, then POSTed one notification
 * per person. So they were lost whenever the tab closed mid-loop; they depended
 * on which screen the action was taken from (a card moved on the sprint board
 * notified nobody, the same move on the Tasks board did); they named the wrong
 * person ("reviewed by Manager", hard-coded); and since the endpoint had to
 * accept a notification addressed to somebody else, any member could write one
 * to any colleague saying anything.
 *
 * They are produced here now, from the events the services emit after the write
 * commits. The `type` strings are the ones the browser used, so everybody's
 * existing notification preferences, and the icons and links keyed on them, go
 * on applying unchanged.
 *
 * Like NotificationSubscriber, nothing here throws back into the request that
 * caused it: a failed delivery is logged.
 */
@Injectable()
export class WorkNotificationSubscriber {
  private readonly logger = new Logger('WorkNotificationSubscriber');

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly preferences: NotificationPreferencesService,
    private readonly mail: MailService,
  ) {}

  /**
   * One notification per recipient — and never one to the person who did the
   * thing, unless the notice is not about their action at all (`includeActor`).
   * `email` mirrors the old client rule for which types also went out as mail.
   *
   * Only to the workspace's CURRENT members, unless the notice is about losing
   * membership itself (`formerMembers`). Recipients are read off the work — a
   * task's assignees, a sprint's team — and somebody removed from the workspace
   * stays on those lists, so they went on being mailed task titles, status
   * changes and comments from a workspace they could no longer open.
   */
  private async tell(
    recipients: readonly string[],
    actorId: string | undefined,
    notice: Notice,
    opts: { email?: boolean; includeActor?: boolean; formerMembers?: boolean } = {},
  ): Promise<void> {
    const named = [...new Set(recipients)].filter(
      (id) => Boolean(id) && (opts.includeActor || id !== actorId),
    );
    const ids = opts.formerMembers ? named : await this.currentMembers(notice.workspaceId, named);
    await Promise.all(
      ids.map(async (userId) => {
        try {
          await this.notifications.deliver({ ...notice, userId });
          if (opts.email) await this.sendMail(userId, notice);
        } catch (err) {
          this.logger.warn(`${notice.type} to ${userId} failed: ${(err as Error).message}`);
        }
      }),
    );
  }

  /** Those of `userIds` who are ACTIVE members of the workspace. */
  private async currentMembers(workspaceId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0 || !workspaceId) return [];
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, status: 'ACTIVE', userId: { in: userIds } },
      select: { userId: true },
    });
    const current = new Set(rows.map((r) => r.userId));
    return userIds.filter((id) => current.has(id));
  }

  /** The mail copy, when the recipient has not turned that channel off. */
  private async sendMail(userId: string, notice: Notice): Promise<void> {
    // Configured, not "delivered last time": see MailService.configured.
    if (!this.mail.configured) return;
    if (!(await this.preferences.allows(notice.workspaceId, userId, notice.type, 'email'))) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, isActive: true },
    });
    if (!user?.isActive) return;
    await this.mail.sendNotification({
      to: user.email,
      name: user.name || user.email,
      title: notice.title,
      message: notice.message,
    });
  }

  private async projectName(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    return project?.name ?? 'the project';
  }

  // ------------------------------------------------------------------ tasks

  @OnEvent(TaskEvents.Assigned)
  async onTaskAssigned(e: DomainEvent<TaskAssignedPayload>): Promise<void> {
    const p = e.payload;
    await this.tell(
      p.assigneeIds,
      p.actorId,
      {
        workspaceId: p.workspaceId,
        type: 'TASK_ASSIGNED',
        title: `New Task Assigned: ${p.title}`,
        message: `${p.actorName} assigned you a task in ${await this.projectName(p.projectId)}`,
        projectId: p.projectId,
        relatedEntityId: p.taskId,
        relatedEntityType: 'TASK',
      },
      { email: true },
    );
  }

  @OnEvent(TaskEvents.StatusChanged)
  async onTaskStatusChanged(e: DomainEvent<TaskStatusChangedPayload>): Promise<void> {
    const p = e.payload;
    const link = {
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      relatedEntityId: p.taskId,
      relatedEntityType: 'TASK',
    };

    if (p.to === 'REVIEW') {
      // Review is asked OF the people who can sign a task off.
      const reviewers = await this.access.membersHolding(p.workspaceId, Permission.TaskWrite);
      await this.tell(
        reviewers,
        p.actorId,
        {
          ...link,
          type: 'TASK_REVIEW_REQUESTED',
          title: `Task Ready for Review: ${p.title}`,
          message: `${p.actorName} has submitted "${p.title}" (${p.hierarchyId}) for review in ${await this.projectName(p.projectId)}`,
        },
        { email: true },
      );
      // And the people doing it, when somebody else moved it there: every
      // other move told them, this one only told the reviewers.
      const reviewing = new Set(reviewers);
      await this.tell(
        p.assigneeIds.filter((id) => !reviewing.has(id)),
        p.actorId,
        {
          ...link,
          type: 'TASK_STATUS_CHANGED',
          title: `Task in Review: ${p.title}`,
          message: `${p.actorName} moved "${p.title}" to Review`,
        },
      );
      return;
    }

    if (p.to === 'DONE') {
      await this.tell(
        p.assigneeIds,
        p.actorId,
        {
          ...link,
          type: 'TASK_REVIEWED_DONE',
          title: `Task Approved: ${p.title}`,
          message: `Your task "${p.title}" (${p.hierarchyId}) has been reviewed and marked as done by ${p.actorName}`,
        },
        { email: true },
      );
      await this.announceSprintReady(p);
      return;
    }

    await this.tell(p.assigneeIds, p.actorId, {
      ...link,
      type: 'TASK_STATUS_CHANGED',
      title: `Task Status Changed: ${p.title}`,
      message: `${p.actorName} moved "${p.title}" to ${STATUS_LABEL[p.to] ?? p.to}`,
    });
  }

  /** The last open task of a running sprint was just finished: say it can close. */
  private async announceSprintReady(p: TaskStatusChangedPayload): Promise<void> {
    if (!p.sprintId) return;
    const [sprint, open] = await Promise.all([
      this.prisma.sprint.findUnique({
        where: { id: p.sprintId },
        select: { name: true, status: true },
      }),
      this.prisma.task.count({ where: { sprintId: p.sprintId, status: { not: 'DONE' } } }),
    ]);
    if (!sprint || sprint.status !== 'ACTIVE' || open > 0) return;
    // About the sprint, not about who finished the task — so the person who did
    // is told as well; they are quite likely the one who will close it.
    const planners = await this.access.membersHolding(p.workspaceId, Permission.PlanningWrite);
    await this.tell(
      planners,
      p.actorId,
      {
        workspaceId: p.workspaceId,
        type: 'SPRINT_READY_TO_CLOSE',
        title: `Sprint Ready to Close: ${sprint.name}`,
        message: `All tasks in "${sprint.name}" are complete. The sprint is ready to be closed.`,
        projectId: p.projectId,
        relatedEntityId: p.sprintId,
        relatedEntityType: 'SPRINT',
      },
      { email: true, includeActor: true },
    );
  }

  @OnEvent(TaskEvents.PriorityChanged)
  async onTaskPriorityChanged(e: DomainEvent<TaskPriorityChangedPayload>): Promise<void> {
    const p = e.payload;
    await this.tell(p.assigneeIds, p.actorId, {
      workspaceId: p.workspaceId,
      type: 'TASK_PRIORITY_CHANGED',
      title: `Task Priority Changed: ${p.title}`,
      message: `${p.actorName} changed the priority of "${p.title}" to ${titleCase(p.priority)}`,
      projectId: p.projectId,
      relatedEntityId: p.taskId,
      relatedEntityType: 'TASK',
    });
  }

  // ---------------------------------------------------------------- sprints

  /** Everybody with a task in the sprint. */
  private async sprintTeam(sprintId: string): Promise<string[]> {
    const tasks = await this.prisma.task.findMany({
      where: { sprintId },
      select: { assigneeIds: true },
    });
    return tasks.flatMap((t) => (Array.isArray(t.assigneeIds) ? (t.assigneeIds as string[]) : []));
  }

  @OnEvent(PlanningEvents.SprintStarted)
  async onSprintStarted(e: DomainEvent<SprintLifecyclePayload>): Promise<void> {
    const p = e.payload;
    const [sprint, taskCount, team] = await Promise.all([
      this.prisma.sprint.findUnique({ where: { id: p.sprintId }, select: { name: true } }),
      this.prisma.task.count({ where: { sprintId: p.sprintId } }),
      this.sprintTeam(p.sprintId),
    ]);
    if (!sprint) return;
    await this.tell(
      team,
      p.actorId,
      {
        workspaceId: p.workspaceId,
        type: 'SPRINT_STARTED',
        title: `Sprint Started: ${sprint.name}`,
        message: `${sprint.name} has started with ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`,
        projectId: p.projectId,
        relatedEntityId: p.sprintId,
        relatedEntityType: 'SPRINT',
      },
      { email: true },
    );
  }

  @OnEvent(PlanningEvents.SprintCompleted)
  async onSprintCompleted(e: DomainEvent<SprintLifecyclePayload>): Promise<void> {
    const p = e.payload;
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: p.sprintId },
      select: { name: true, completedTaskCount: true, totalTaskCount: true },
    });
    if (!sprint) return;
    // The team as it stood BEFORE unfinished tasks were rolled out — carried on
    // the event, because by now those tasks no longer name this sprint.
    await this.tell(
      p.assigneeIds ?? (await this.sprintTeam(p.sprintId)),
      p.actorId,
      {
        workspaceId: p.workspaceId,
        type: 'SPRINT_COMPLETED',
        title: `Sprint Completed: ${sprint.name}`,
        message: `${sprint.name} completed with ${sprint.completedTaskCount ?? 0}/${sprint.totalTaskCount ?? 0} tasks done`,
        projectId: p.projectId,
        relatedEntityId: p.sprintId,
        relatedEntityType: 'SPRINT',
      },
      { email: true },
    );
  }

  // ------------------------------------------------------------------ leave

  @OnEvent(HrEvents.LeaveRequested)
  async onLeaveRequested(e: DomainEvent<LeaveRequestedPayload>): Promise<void> {
    const p = e.payload;
    // Resolved as a PERMISSION, so a custom approver role is told too — the
    // browser matched role names and skipped them.
    const approvers = await this.access.membersHolding(p.workspaceId, Permission.LeaveApprove);
    await this.tell(
      approvers,
      p.userId,
      {
        workspaceId: p.workspaceId,
        type: 'LEAVE_REQUESTED',
        title: `New Leave Request: ${p.requesterName}`,
        message: `${p.requesterName} requested ${titleCase(p.type).replace(/_/g, ' ')} leave for ${p.daysCount} day(s)`,
        relatedEntityId: p.leaveRequestId,
        relatedEntityType: 'LEAVE',
      },
      { email: true },
    );
  }

  // ----------------------------------------------------------------- notices

  /** "Tell these people this" — see notice.ts. */
  @OnEvent(NOTICE_EVENT)
  async onNotice(notice: NoticePayload): Promise<void> {
    let recipients = notice.recipients;
    if (notice.oncePerUnread && recipients.length) {
      const waiting = await this.prisma.notification.findMany({
        where: {
          workspaceId: notice.workspaceId,
          type: notice.type,
          isRead: false,
          userId: { in: [...recipients] },
        },
        select: { userId: true },
      });
      const told = new Set(waiting.map((n) => n.userId));
      recipients = recipients.filter((id) => !told.has(id));
    }
    await this.tell(
      recipients,
      notice.actorId || undefined,
      {
        workspaceId: notice.workspaceId,
        type: notice.type,
        title: notice.title,
        message: notice.message,
        projectId: notice.projectId,
        relatedEntityId: notice.relatedEntityId,
        relatedEntityType: notice.relatedEntityType,
      },
      { email: notice.email },
    );
  }

  // -------------------------------------------------------------- membership

  private async workspaceLabel(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });
    return workspace?.name ? `"${workspace.name}"` : 'a workspace';
  }

  /**
   * Taken out of a workspace by somebody else. Leaving is the person's own act
   * and tells nobody anything they do not know.
   *
   * Nothing said so. The workspace simply stopped being in the switcher, and
   * whatever the person had open in it began to answer "not found".
   */
  @OnEvent(WorkspaceEvents.MemberRemoved)
  async onMemberRemoved(e: DomainEvent<WorkspaceMemberRemovedPayload>): Promise<void> {
    const p = e.payload;
    // Leaving, or turning an invitation down, is the person's own act.
    if (p.via === 'left' || p.via === 'declined') return;
    const workspace = await this.workspaceLabel(p.workspaceId);
    // An invitation taken back was never access: "removed ... no longer have
    // access" would tell them they had lost something they never had.
    const withdrawn = p.via === 'withdrawn';
    await this.tell(
      [p.userId],
      undefined,
      {
        workspaceId: p.workspaceId,
        type: NotifiableEvent[WorkspaceEvents.MemberRemoved],
        title: withdrawn ? 'Invitation withdrawn' : 'Removed from a workspace',
        message: withdrawn
          ? `Your invitation to ${workspace} was withdrawn.`
          : `You were removed from ${workspace} and no longer have access to it.`,
        relatedEntityId: p.workspaceId,
        relatedEntityType: 'workspace',
      },
      { email: !withdrawn, formerMembers: true },
    );
  }

  /**
   * Somebody was asked to join a workspace: tell them, and how to answer.
   *
   * Adding a person used to put them straight in — a stranger's workspace in
   * their switcher, its notices in their inbox, and a role in it they never
   * agreed to. An invitation grants nothing until they accept it, so they have
   * to hear of it: in the inbox, which is filed by recipient and so shows a
   * notice from a workspace they cannot see into yet, and by mail, since
   * somebody with no workspace yet has no inbox open.
   */
  @OnEvent(WorkspaceEvents.MemberInvited)
  async onMemberInvited(e: DomainEvent<WorkspaceMemberInvitedPayload>): Promise<void> {
    const p = e.payload;
    const workspace = await this.workspaceLabel(p.workspaceId);
    // SOFTWARE_DEVELOPER -> "Software Developer"; a custom role as its author wrote it.
    const role = isBuiltInRole(p.role) ? p.role.split('_').map(titleCase).join(' ') : p.role;
    await this.tell(
      [p.userId],
      undefined,
      {
        workspaceId: p.workspaceId,
        type: NotifiableEvent[WorkspaceEvents.MemberInvited],
        title: 'Invitation to a workspace',
        message: `${p.inviterName} invited you to ${workspace} as ${role}. Accept or decline it on your Workspaces page; until you accept, you are not a member.`,
        relatedEntityId: p.workspaceId,
        relatedEntityType: 'workspace',
      },
      { email: true, formerMembers: true },
    );
  }

  /** Access switched off, or back on. */
  @OnEvent(WorkspaceEvents.MemberStatusChanged)
  async onMemberStatusChanged(
    e: DomainEvent<WorkspaceMemberStatusChangedPayload>,
  ): Promise<void> {
    const p = e.payload;
    const off = p.status !== 'ACTIVE' && p.previousStatus === 'ACTIVE';
    const on = p.status === 'ACTIVE' && p.previousStatus !== 'ACTIVE';
    if (!off && !on) return;
    const workspace = await this.workspaceLabel(p.workspaceId);
    await this.tell(
      [p.userId],
      undefined,
      {
        workspaceId: p.workspaceId,
        type: NotifiableEvent[WorkspaceEvents.MemberStatusChanged],
        title: off ? 'Workspace access switched off' : 'Workspace access restored',
        message: off
          ? `Your access to ${workspace} was switched off. One of its managers can switch it back on.`
          : `Your access to ${workspace} was switched back on.`,
        relatedEntityId: p.workspaceId,
        relatedEntityType: 'workspace',
      },
      { email: true, formerMembers: true },
    );
  }

  /**
   * The mail copy of a declined request to join. The in-app notice is written
   * by NotificationSubscriber; somebody who belongs to no workspace has no
   * inbox open to find it in, so where mail works they are mailed as well.
   */
  @OnEvent(WorkspaceEvents.JoinRequestRejected)
  async onJoinRequestRejected(e: DomainEvent<JoinRequestHandledPayload>): Promise<void> {
    const p = e.payload;
    try {
      await this.sendMail(p.userId, {
        workspaceId: p.workspaceId,
        type: NotifiableEvent[WorkspaceEvents.JoinRequestRejected],
        title: 'Join request declined',
        message: `Your request to join ${await this.workspaceLabel(p.workspaceId)} was declined.`,
      });
    } catch (err) {
      this.logger.warn(`join-request mail to ${p.userId} failed: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------- requirements

  /**
   * Who a new requirement or epic in a project is news to: the people working
   * on that project — its owner, and everybody assigned to one of its tasks or
   * functional requirements — and the workspace's planners (planning:write),
   * who turn requirements into epics and epics into sprints wherever they land.
   *
   * It was every active member of the workspace. A workspace runs several
   * projects, so each requirement and epic in any of them reached everybody in
   * all of them: a developer on one project read every other project's backlog
   * being written, and the notices that were theirs drowned in it. A project has
   * no member list of its own (project.prisma), so its people are read off its
   * work; somebody not yet given any has nothing in it to be told about. `tell`
   * still keeps it to current members and leaves out whoever created it.
   */
  private async projectAudience(workspaceId: string, projectId: string): Promise<string[]> {
    const [project, tasks, requirements, planners] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } }),
      this.prisma.task.findMany({ where: { projectId }, select: { assigneeIds: true } }),
      this.prisma.functionalRequirement.findMany({
        where: { projectId },
        select: { assigneeIds: true },
      }),
      this.access.membersHolding(workspaceId, Permission.PlanningWrite),
    ]);
    return [
      ...(project?.ownerId ? [project.ownerId] : []),
      ...[...tasks, ...requirements].flatMap((row) => userIdsIn(row.assigneeIds)),
      ...planners,
    ];
  }

  @OnEvent(RequirementEvents.ClientRequirementCreated)
  async onClientRequirementCreated(e: DomainEvent<RequirementAnnouncedPayload>): Promise<void> {
    const p = e.payload;
    await this.tell(await this.projectAudience(p.workspaceId, p.projectId), p.actorId, {
      workspaceId: p.workspaceId,
      type: 'REQUIREMENT_CREATED',
      title: `New Requirement: ${p.title}`,
      message: `${p.actorName} created a new client requirement "${p.title}" in ${await this.projectName(p.projectId)}`,
      projectId: p.projectId,
      relatedEntityId: p.entityId,
      relatedEntityType: 'REQUIREMENT',
    });
  }

  @OnEvent(RequirementEvents.EpicCreated)
  async onEpicCreated(e: DomainEvent<RequirementAnnouncedPayload>): Promise<void> {
    const p = e.payload;
    await this.tell(await this.projectAudience(p.workspaceId, p.projectId), p.actorId, {
      workspaceId: p.workspaceId,
      type: 'EPIC_CREATED',
      title: `New Epic Created: ${p.title}`,
      message: `${p.actorName} created a new epic "${p.title}" in ${await this.projectName(p.projectId)}`,
      projectId: p.projectId,
      relatedEntityId: p.entityId,
      relatedEntityType: 'EPIC',
    });
  }

  @OnEvent(RequirementEvents.FunctionalRequirementAssigned)
  async onFunctionalRequirementAssigned(
    e: DomainEvent<RequirementAnnouncedPayload>,
  ): Promise<void> {
    const p = e.payload;
    await this.tell(
      p.assigneeIds ?? [],
      p.actorId,
      {
        workspaceId: p.workspaceId,
        type: 'FR_ASSIGNED',
        title: `FR Assigned: ${p.title}`,
        message: `${p.actorName} assigned you to functional requirement "${p.title}"`,
        projectId: p.projectId,
        relatedEntityId: p.entityId,
        relatedEntityType: 'FR',
      },
      { email: true },
    );
  }
}
