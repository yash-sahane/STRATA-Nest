import type { PrismaService } from '@strata/prisma';
import {
  HrEvents,
  PlanningEvents,
  RequirementEvents,
  TaskEvents,
  type DomainEvent,
  type RequirementAnnouncedPayload,
  type TaskStatusChangedPayload,
} from '@strata/shared';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { MailService } from '../mail/mail.service';
import type { NotificationPreferencesService } from './notification-preferences.service';
import type { NotificationsService } from './notifications.service';
import { WorkNotificationSubscriber } from './work-notification.subscriber';

const event = <T>(name: string, payload: T): DomainEvent<T> => ({
  name,
  workspaceId: 'w1',
  payload,
  occurredAt: new Date().toISOString(),
});

function build(
  opts: {
    /** Who holds the permission the subscriber asks about. */
    holders?: string[];
    /** Open (not DONE) tasks left in the sprint. */
    openInSprint?: number;
    sprintStatus?: string;
    mailDelivers?: boolean;
    emailAllowed?: boolean;
    /** The assignee lists of the tasks read (a sprint's, or a project's). */
    sprintAssignees?: unknown[][];
    /** The assignee lists of the project's functional requirements. */
    requirementAssignees?: unknown[][];
    projectOwner?: string;
    /** The workspace's whole active roster, for a query that does not name ids. */
    roster?: string[];
    /** People named as recipients who are no longer members of the workspace. */
    formerMembers?: string[];
  } = {},
) {
  const deliver = jest.fn().mockResolvedValue(undefined);
  const sendNotification = jest.fn().mockResolvedValue(undefined);
  const membersHolding = jest.fn().mockResolvedValue(opts.holders ?? []);
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Apollo', ownerId: opts.projectOwner ?? '' }),
    },
    functionalRequirement: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.requirementAssignees ?? []).map((assigneeIds) => ({ assigneeIds }))),
    },
    sprint: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Sprint 3',
        status: opts.sprintStatus ?? 'ACTIVE',
        completedTaskCount: 7,
        totalTaskCount: 10,
      }),
    },
    task: {
      count: jest.fn().mockResolvedValue(opts.openInSprint ?? 0),
      findMany: jest
        .fn()
        .mockResolvedValue((opts.sprintAssignees ?? []).map((assigneeIds) => ({ assigneeIds }))),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ email: 'dev@corp.com', name: 'Dev', isActive: true }),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Web' }) },
    workspaceMember: {
      // Asked "which of these are still members?": all of them, bar the former
      // ones. Asked for everybody: the roster.
      findMany: jest
        .fn()
        .mockImplementation((args: { where?: { userId?: { in?: string[] } } }) =>
          Promise.resolve(
            (args?.where?.userId?.in ?? opts.roster ?? [])
              .filter((id) => !(opts.formerMembers ?? []).includes(id))
              .map((userId) => ({ userId })),
          ),
        ),
    },
  } as unknown as PrismaService;
  const sub = new WorkNotificationSubscriber(
    { deliver } as unknown as NotificationsService,
    prisma,
    { membersHolding } as unknown as WorkspaceAccessService,
    {
      allows: jest.fn().mockResolvedValue(opts.emailAllowed ?? true),
    } as unknown as NotificationPreferencesService,
    // `configured`, not `delivers`: notice mail is queued whenever mail is set up,
    // so one refusal does not switch it off for good (see MailService.configured).
    { configured: opts.mailDelivers ?? false, sendNotification } as unknown as MailService,
  );
  const told = () => deliver.mock.calls.map((c) => [c[0].type, c[0].userId]);
  return { sub, deliver, told, membersHolding, sendNotification };
}

const task = {
  workspaceId: 'w1',
  projectId: 'p1',
  taskId: 't1',
  title: 'Fix login',
  hierarchyId: 'APO-T07',
  actorId: 'actor',
  actorName: 'Asha',
};
const moved = (over: Partial<TaskStatusChangedPayload>) =>
  event<TaskStatusChangedPayload>(TaskEvents.StatusChanged, {
    ...task,
    from: 'TODO',
    to: 'IN_PROGRESS',
    assigneeIds: ['dev', 'actor'],
    sprintId: '',
    ...over,
  });

describe('WorkNotificationSubscriber — tasks', () => {
  it('tells the newly assigned, with a link to the task — and never the person who assigned it', async () => {
    const { sub, deliver, told } = build();
    await sub.onTaskAssigned(
      event(TaskEvents.Assigned, { ...task, assigneeIds: ['dev', 'actor', 'dev'] }),
    );
    expect(told()).toEqual([['TASK_ASSIGNED', 'dev']]);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Task Assigned: Fix login',
        message: 'Asha assigned you a task in Apollo',
        projectId: 'p1',
        relatedEntityId: 't1',
        relatedEntityType: 'TASK',
      }),
    );
  });

  // A task goes on listing people after they leave the workspace; its news is
  // not theirs any more.
  it('does not tell somebody who is no longer a member of the workspace', async () => {
    const { sub, told } = build({ formerMembers: ['dev'] });
    await sub.onTaskStatusChanged(moved({}));
    expect(told()).toEqual([]);
  });

  it('an ordinary move tells the assignees', async () => {
    const { sub, told, deliver } = build();
    await sub.onTaskStatusChanged(moved({}));
    expect(told()).toEqual([['TASK_STATUS_CHANGED', 'dev']]);
    expect(deliver.mock.calls[0][0].message).toBe('Asha moved "Fix login" to In Progress');
  });

  it('a move to Review asks the people who can sign it off, and tells the assignees', async () => {
    const { sub, told, membersHolding } = build({ holders: ['mgr', 'actor'] });
    await sub.onTaskStatusChanged(moved({ to: 'REVIEW' }));
    expect(membersHolding).toHaveBeenCalledWith('w1', 'task:write');
    // The assignee hears that somebody else moved their task, as on every other
    // move; the person who moved it hears nothing either way.
    expect(told()).toEqual([
      ['TASK_REVIEW_REQUESTED', 'mgr'],
      ['TASK_STATUS_CHANGED', 'dev'],
    ]);
  });

  it('an assignee who also signs off is asked to review, not told twice', async () => {
    const { sub, told } = build({ holders: ['mgr', 'dev'] });
    await sub.onTaskStatusChanged(moved({ to: 'REVIEW' }));
    expect(told()).toEqual([
      ['TASK_REVIEW_REQUESTED', 'mgr'],
      ['TASK_REVIEW_REQUESTED', 'dev'],
    ]);
  });

  it('a sign-off tells the assignees who actually signed it', async () => {
    const { sub, told, deliver } = build();
    await sub.onTaskStatusChanged(moved({ from: 'REVIEW', to: 'DONE' }));
    expect(told()).toEqual([['TASK_REVIEWED_DONE', 'dev']]);
    expect(deliver.mock.calls[0][0].message).toContain('marked as done by Asha');
  });

  it('finishing the last open task of a running sprint says it can be closed', async () => {
    const { sub, told } = build({ holders: ['mgr', 'actor'], openInSprint: 0 });
    await sub.onTaskStatusChanged(moved({ from: 'REVIEW', to: 'DONE', sprintId: 's1' }));
    // About the sprint rather than the actor's own action, so they are told too.
    expect(told()).toEqual([
      ['TASK_REVIEWED_DONE', 'dev'],
      ['SPRINT_READY_TO_CLOSE', 'mgr'],
      ['SPRINT_READY_TO_CLOSE', 'actor'],
    ]);
  });

  it('but not while other tasks in the sprint are still open', async () => {
    const { sub, told } = build({ holders: ['mgr'], openInSprint: 2 });
    await sub.onTaskStatusChanged(moved({ from: 'REVIEW', to: 'DONE', sprintId: 's1' }));
    expect(told()).toEqual([['TASK_REVIEWED_DONE', 'dev']]);
  });
});

describe('WorkNotificationSubscriber — sprints and leave', () => {
  it('a sprint closing tells the team it had, from the event rather than the rolled-out tasks', async () => {
    const { sub, told, deliver } = build();
    await sub.onSprintCompleted(
      event(PlanningEvents.SprintCompleted, {
        workspaceId: 'w1',
        projectId: 'p1',
        sprintId: 's1',
        actorId: 'actor',
        assigneeIds: ['dev', 'qa', 'actor'],
      }),
    );
    expect(told()).toEqual([
      ['SPRINT_COMPLETED', 'dev'],
      ['SPRINT_COMPLETED', 'qa'],
    ]);
    expect(deliver.mock.calls[0][0].message).toBe('Sprint 3 completed with 7/10 tasks done');
  });

  it('a sprint starting tells everybody with a task in it', async () => {
    const { sub, told } = build({ sprintAssignees: [['dev'], ['qa', 'dev'], []] });
    await sub.onSprintStarted(
      event(PlanningEvents.SprintStarted, {
        workspaceId: 'w1',
        projectId: 'p1',
        sprintId: 's1',
        actorId: 'actor',
      }),
    );
    expect(told()).toEqual([
      ['SPRINT_STARTED', 'dev'],
      ['SPRINT_STARTED', 'qa'],
    ]);
  });

  it('a leave request goes to whoever can approve it — by permission, not role name', async () => {
    const { sub, told, membersHolding, deliver } = build({ holders: ['mgr', 'custom-approver', 'me'] });
    await sub.onLeaveRequested(
      event(HrEvents.LeaveRequested, {
        workspaceId: 'w1',
        userId: 'me',
        leaveRequestId: 'lr1',
        type: 'CASUAL',
        daysCount: 2,
        requesterName: 'Ravi',
      }),
    );
    expect(membersHolding).toHaveBeenCalledWith('w1', 'leave:approve');
    expect(told()).toEqual([
      ['LEAVE_REQUESTED', 'mgr'],
      ['LEAVE_REQUESTED', 'custom-approver'],
    ]);
    expect(deliver.mock.calls[0][0].message).toBe('Ravi requested Casual leave for 2 day(s)');
  });
});

describe('WorkNotificationSubscriber — requirements and epics', () => {
  const announced = (name: string) =>
    event<RequirementAnnouncedPayload>(name, {
      workspaceId: 'w1',
      projectId: 'p1',
      entityId: 'x1',
      title: 'Checkout',
      actorId: 'actor',
      actorName: 'Asha',
    });
  // Somebody in the workspace with nothing in this project: 'bystander'.
  const workspace = {
    roster: ['owner', 'dev', 'qa', 'analyst', 'mgr', 'actor', 'bystander', 'gone'],
    projectOwner: 'owner',
    sprintAssignees: [['dev'], ['dev', 'qa'], [42, null, ''], ['gone']],
    requirementAssignees: [['analyst']],
    holders: ['mgr', 'actor'],
    formerMembers: ['gone'],
  };

  it('a new requirement goes to the project’s people and the planners, not the whole workspace', async () => {
    const { sub, told, membersHolding, deliver } = build(workspace);
    await sub.onClientRequirementCreated(announced(RequirementEvents.ClientRequirementCreated));
    expect(membersHolding).toHaveBeenCalledWith('w1', 'planning:write');
    // Never the one who created it, nor somebody who has since left.
    expect(told()).toEqual([
      ['REQUIREMENT_CREATED', 'owner'],
      ['REQUIREMENT_CREATED', 'dev'],
      ['REQUIREMENT_CREATED', 'qa'],
      ['REQUIREMENT_CREATED', 'analyst'],
      ['REQUIREMENT_CREATED', 'mgr'],
    ]);
    expect(deliver.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        title: 'New Requirement: Checkout',
        projectId: 'p1',
        relatedEntityId: 'x1',
        relatedEntityType: 'REQUIREMENT',
      }),
    );
  });

  it('so does a new epic', async () => {
    const { sub, told } = build(workspace);
    await sub.onEpicCreated(announced(RequirementEvents.EpicCreated));
    expect(told().map(([type]) => type)).toEqual(Array(5).fill('EPIC_CREATED'));
    expect(told().map(([, userId]) => userId)).toEqual(['owner', 'dev', 'qa', 'analyst', 'mgr']);
  });
});

describe('WorkNotificationSubscriber — mail and failures', () => {
  const assigned = event(TaskEvents.Assigned, { ...task, assigneeIds: ['dev'] });

  it('sends the mail copy when mail can be delivered and the recipient allows it', async () => {
    const { sub, sendNotification } = build({ mailDelivers: true });
    await sub.onTaskAssigned(assigned);
    expect(sendNotification).toHaveBeenCalledWith({
      to: 'dev@corp.com',
      name: 'Dev',
      title: 'New Task Assigned: Fix login',
      message: 'Asha assigned you a task in Apollo',
    });
  });

  it('sends none when the recipient turned the email channel off, or no mail can leave', async () => {
    const muted = build({ mailDelivers: true, emailAllowed: false });
    await muted.sub.onTaskAssigned(assigned);
    expect(muted.sendNotification).not.toHaveBeenCalled();

    const noMail = build({ mailDelivers: false });
    await noMail.sub.onTaskAssigned(assigned);
    expect(noMail.sendNotification).not.toHaveBeenCalled();
  });

  it('never mails a status change — only the types that always did', async () => {
    const { sub, sendNotification } = build({ mailDelivers: true });
    await sub.onTaskStatusChanged(moved({}));
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('does not let one failed delivery stop the others, or reach the request', async () => {
    const { sub, deliver } = build();
    deliver.mockRejectedValueOnce(new Error('db down'));
    await expect(
      sub.onTaskAssigned(event(TaskEvents.Assigned, { ...task, assigneeIds: ['a', 'b'] })),
    ).resolves.toBeUndefined();
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});

describe('WorkNotificationSubscriber — invitations', () => {
  const invited = event('workspace.member.invited', {
    workspaceId: 'w1',
    userId: 'guest',
    role: 'SOFTWARE_DEVELOPER',
    actorId: 'mgr',
    inviterName: 'Priya',
  });

  it('tells the invited person — although they are not a member — who asked, where, as what, and how to answer', async () => {
    // Not on the roster: an invitation is exactly a notice to somebody outside.
    const { sub, deliver, sendNotification } = build({ formerMembers: ['guest'], mailDelivers: true });
    await sub.onMemberInvited(invited);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'guest',
        type: 'WORKSPACE_INVITATION',
        relatedEntityType: 'workspace',
        message: expect.stringMatching(
          /^Priya invited you to "Acme Web" as Software Developer\. Accept or decline it/,
        ),
      }),
    );
    // Somebody with no workspace yet has no inbox open: mailed as well.
    expect(sendNotification).toHaveBeenCalled();
  });

  it('a declined invitation tells nobody — it was their own answer', async () => {
    const { sub, deliver } = build();
    await sub.onMemberRemoved(
      event('workspace.member.removed', {
        workspaceId: 'w1',
        userId: 'guest',
        role: 'MEMBER',
        via: 'declined' as const,
        actorId: 'guest',
      }),
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a withdrawn one says withdrawn, not "removed ... no longer have access"', async () => {
    const { sub, deliver } = build({ formerMembers: ['guest'] });
    await sub.onMemberRemoved(
      event('workspace.member.removed', {
        workspaceId: 'w1',
        userId: 'guest',
        role: 'MEMBER',
        via: 'withdrawn' as const,
        actorId: 'mgr',
      }),
    );
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invitation withdrawn',
        message: 'Your invitation to "Acme Web" was withdrawn.',
      }),
    );
  });
});
