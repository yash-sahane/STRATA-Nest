import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { DeadlineReminderService } from './deadline-reminder.service';

const NOW = new Date('2026-03-10T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const user = { id: 'u1' } as User;

type TaskRow = {
  id: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  assigneeIds: unknown;
};

const idsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function build(
  options: {
    tasks?: TaskRow[];
    alreadySent?: Array<{ userId: string; type: string; relatedEntityId: string; createdAt?: Date }>;
    emailAllowed?: boolean;
    /** Assignees who have since left the workspace. */
    formerMembers?: string[];
    /** The workspace's declared zone. UTC unless a test is about zones, so the
     *  suite does not depend on the zone of the machine running it. */
    timezone?: string;
    /** Ids of the workspace's archived projects. */
    archivedProjects?: string[];
  } = {},
) {
  const taskFindMany = jest.fn().mockResolvedValue(options.tasks ?? []);
  const projectFindMany = jest
    .fn()
    .mockResolvedValue((options.archivedProjects ?? []).map((id) => ({ id })));
  const notificationFindMany = jest
    .fn()
    .mockResolvedValue((options.alreadySent ?? []).map((row) => ({ createdAt: NOW, ...row })));
  const userFindMany = jest
    .fn()
    .mockResolvedValue([{ id: 'a1', email: 'a1@example.com', name: 'Ann' }]);
  const members = [
    ...new Set((options.tasks ?? []).flatMap((t) => idsIn(t.assigneeIds))),
  ].filter((id) => !(options.formerMembers ?? []).includes(id));
  const prisma = {
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ settings: { timezone: options.timezone ?? 'UTC' } }),
    },
    task: { findMany: taskFindMany },
    notification: { findMany: notificationFindMany },
    user: { findMany: userFindMany },
    workspaceMember: { findMany: jest.fn().mockResolvedValue(members.map((userId) => ({ userId }))) },
    project: { findMany: projectFindMany },
  } as unknown as PrismaService;

  const assertMember = jest.fn().mockResolvedValue(undefined);
  const deliver = jest.fn().mockResolvedValue(undefined);
  const allows = jest.fn().mockResolvedValue(options.emailAllowed ?? true);
  const sendTaskDeadlineReminder = jest.fn().mockResolvedValue(undefined);

  const svc = new DeadlineReminderService(
    prisma,
    { assertMember } as never,
    { deliver } as never,
    { allows } as never,
    { sendTaskDeadlineReminder } as never,
  );
  return { svc, taskFindMany, notificationFindMany, assertMember, deliver, allows, sendTaskDeadlineReminder };
}

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 't1',
  title: 'Ship it',
  projectId: 'p1',
  dueDate: at(3),
  assigneeIds: ['a1'],
  ...over,
});

describe('DeadlineReminderService.scan', () => {
  it('does not remind somebody who has left the workspace', async () => {
    const { svc, deliver } = build({ tasks: [task()], formerMembers: ['a1'] });
    await expect(svc.scan('w1', NOW)).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('notifies each assignee of a task due on a reminder day', async () => {
    const { svc, deliver } = build({ tasks: [task()] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(1);

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        userId: 'a1',
        type: 'TASK_DEADLINE_REMINDER',
        relatedEntityId: 't1',
        relatedEntityType: 'TASK',
        projectId: 'p1',
      }),
    );
  });

  it('reminds on the due day itself, and says so', async () => {
    const { svc, deliver } = build({ tasks: [task({ dueDate: at(0) })] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(1);
    expect(deliver.mock.calls[0][0].message).toContain('is due today');
  });

  it('ignores a due date that is not on a reminder day', async () => {
    const { svc, deliver } = build({ tasks: [task({ dueDate: at(4) })] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('skips a reminder already written today for the same recipient + task', async () => {
    const { svc, deliver } = build({
      tasks: [task()],
      alreadySent: [{ userId: 'a1', type: 'TASK_DEADLINE_REMINDER', relatedEntityId: 't1' }],
    });

    await expect(svc.scan('w1', NOW)).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('de-duplicates a recipient listed twice', async () => {
    const { svc, deliver } = build({ tasks: [task({ assigneeIds: ['a1', 'a1'] })] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('reports a task overdue by up to 7 days but not beyond', async () => {
    const within = build({ tasks: [task({ dueDate: at(-7) })] });
    await expect(within.svc.scan('w1', NOW)).resolves.toBe(1);
    expect(within.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TASK_OVERDUE' }),
    );

    const beyond = build({ tasks: [task({ dueDate: at(-8) })] });
    await expect(beyond.svc.scan('w1', NOW)).resolves.toBe(0);
  });

  it('never treats a non-string entry in the JSON assignee columns as a user id', async () => {
    const { svc, deliver } = build({ tasks: [task({ assigneeIds: [null, 42, '', 'a1'] })] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'a1' }));
  });

  it('leaves an archived project out of the scan: its tasks cannot be finished or moved', async () => {
    const { svc, taskFindMany } = build({ tasks: [], archivedProjects: ['p-old', 'p-older'] });
    await svc.scan('w1', NOW);
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: { notIn: ['p-old', 'p-older'] } }),
      }),
    );

    const none = build({ tasks: [] });
    await none.svc.scan('w1', NOW);
    expect(none.taskFindMany.mock.calls[0][0].where).not.toHaveProperty('projectId');
  });

  it('mails the reminder unless the recipient turned the email channel off', async () => {
    const on = build({ tasks: [task()] });
    await on.svc.scan('w1', NOW);
    expect(on.sendTaskDeadlineReminder).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a1@example.com' }),
    );

    const off = build({ tasks: [task()], emailAllowed: false });
    await off.svc.scan('w1', NOW);
    expect(off.deliver).toHaveBeenCalledTimes(1); // in-app is a separate channel
    expect(off.sendTaskDeadlineReminder).not.toHaveBeenCalled();
  });

  it('does not query notifications or users when nothing is due', async () => {
    const { svc, notificationFindMany } = build({ tasks: [] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(0);
    expect(notificationFindMany).not.toHaveBeenCalled();
  });
});

/**
 * A due date is stored as its day's midnight in the zone it was picked in, so
 * "13 Nov" picked in Kolkata is 12 Nov 18:30 UTC and in Los Angeles 13 Nov
 * 08:00 UTC. Days are the workspace's business days, never UTC's.
 */
describe('DeadlineReminderService.scan — business days', () => {
  const KOLKATA = 'Asia/Kolkata'; // UTC+5:30
  const LOS_ANGELES = 'America/Los_Angeles'; // UTC-8 in November, UTC-7 before the 1st
  const dueInKolkata = new Date('2026-11-12T18:30:00.000Z'); // 13 Nov, 00:00 IST
  const dueInLosAngeles = new Date('2026-11-13T08:00:00.000Z'); // 13 Nov, 00:00 PST

  const messageAt = async (timezone: string, dueDate: Date, now: Date) => {
    const { svc, deliver } = build({ timezone, tasks: [task({ dueDate })] });
    await svc.scan('w1', now);
    return deliver.mock.calls.map((c) => c[0].message as string);
  };

  it('east of UTC: prints the day the task is due, not the UTC date of its midnight', async () => {
    // 6 Nov, 09:00 IST: a week out.
    await expect(messageAt(KOLKATA, dueInKolkata, new Date('2026-11-06T03:30:00.000Z'))).resolves.toEqual([
      'Reminder: "Ship it" is due on Nov 13, 2026. 7 day(s) remaining.',
    ]);
  });

  it('east of UTC: the day turns at the office midnight, not at UTC midnight', async () => {
    // 12 Nov 23:59 IST — still the day before.
    await expect(messageAt(KOLKATA, dueInKolkata, new Date('2026-11-12T18:29:00.000Z'))).resolves.toEqual([
      'Reminder: "Ship it" is due on Nov 13, 2026. 1 day(s) remaining.',
    ]);
    // 13 Nov 00:01 IST, though it is still the 12th in UTC.
    await expect(messageAt(KOLKATA, dueInKolkata, new Date('2026-11-12T18:31:00.000Z'))).resolves.toEqual([
      'Reminder: "Ship it" is due today (Nov 13, 2026).',
    ]);
  });

  it('west of UTC: the day turns at the office midnight, not at UTC midnight', async () => {
    // 12 Nov 23:59 PST, though it is already the 13th in UTC.
    await expect(
      messageAt(LOS_ANGELES, dueInLosAngeles, new Date('2026-11-13T07:59:00.000Z')),
    ).resolves.toEqual(['Reminder: "Ship it" is due on Nov 13, 2026. 1 day(s) remaining.']);
    // 13 Nov 00:01 PST.
    await expect(
      messageAt(LOS_ANGELES, dueInLosAngeles, new Date('2026-11-13T08:01:00.000Z')),
    ).resolves.toEqual(['Reminder: "Ship it" is due today (Nov 13, 2026).']);
    // 14 Nov 00:01 PST: overdue, by one day.
    await expect(
      messageAt(LOS_ANGELES, dueInLosAngeles, new Date('2026-11-14T08:01:00.000Z')),
    ).resolves.toEqual(['"Ship it" is overdue by 1 day(s)']);
  });

  it('counts a reminder sent after the office midnight but before UTC midnight as today’s', async () => {
    const { svc, deliver } = build({
      timezone: KOLKATA,
      tasks: [task({ dueDate: dueInKolkata })],
      // Sent 13 Nov 00:15 IST — which is still 12 Nov in UTC.
      alreadySent: [
        {
          userId: 'a1',
          type: 'TASK_DEADLINE_REMINDER',
          relatedEntityId: 't1',
          createdAt: new Date('2026-11-12T18:45:00.000Z'),
        },
      ],
    });
    // 13 Nov 06:30 IST, the next UTC day: the same business day, so nothing new.
    await expect(svc.scan('w1', new Date('2026-11-13T01:00:00.000Z'))).resolves.toBe(0);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('does not count yesterday’s notice as today’s, though UTC says it is the same day', async () => {
    const { svc, deliver } = build({
      timezone: KOLKATA,
      tasks: [task({ dueDate: new Date('2026-11-11T18:30:00.000Z') })], // due 12 Nov IST
      // 13 Nov 23:50 IST: "overdue by 1 day".
      alreadySent: [
        {
          userId: 'a1',
          type: 'TASK_OVERDUE',
          relatedEntityId: 't1',
          createdAt: new Date('2026-11-13T18:20:00.000Z'),
        },
      ],
    });
    // 14 Nov 00:10 IST — still 13 Nov in UTC: a new business day, so it is told.
    await expect(svc.scan('w1', new Date('2026-11-13T18:40:00.000Z'))).resolves.toBe(1);
    expect(deliver.mock.calls[0][0].message).toBe('"Ship it" is overdue by 2 day(s)');
  });

  /**
   * The scheduler's real life, compressed: a scan every hour from `from` to
   * `to`, against a notification table that keeps what each scan wrote.
   */
  async function hourlyScans(timezone: string, dueDate: Date, from: string, to: string) {
    const written: Array<{ userId: string; type: string; relatedEntityId: string; createdAt: Date; message: string }> = [];
    let clock = new Date(from);
    const prisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ settings: { timezone } }) },
      task: {
        // Honours the scan's window, so the window is under test too.
        findMany: jest.fn(({ where }: { where: { dueDate: { gte: Date; lte: Date } } }) =>
          Promise.resolve(
            dueDate >= where.dueDate.gte && dueDate <= where.dueDate.lte
              ? [{ id: 't1', title: 'Ship it', projectId: 'p1', dueDate, assigneeIds: ['a1'] }]
              : [],
          ),
        ),
      },
      notification: {
        findMany: jest.fn(({ where }: { where: { createdAt: { gte: Date } } }) =>
          Promise.resolve(written.filter((row) => row.createdAt >= where.createdAt.gte)),
        ),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', email: 'a1@example.com', name: 'Ann' }]) },
      workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'a1' }]) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const deliver = jest.fn((row: { userId: string; type: string; relatedEntityId: string; message: string }) => {
      written.push({ ...row, createdAt: clock });
      return Promise.resolve();
    });
    const sendTaskDeadlineReminder = jest.fn().mockResolvedValue(undefined);
    const svc = new DeadlineReminderService(
      prisma,
      { assertMember: jest.fn() } as never,
      { deliver } as never,
      { allows: jest.fn().mockResolvedValue(true) } as never,
      { sendTaskDeadlineReminder } as never,
    );
    for (; clock.getTime() <= new Date(to).getTime(); clock = new Date(clock.getTime() + HOUR)) {
      await svc.scan('w1', clock);
    }
    return {
      messages: written.map((row) => row.message),
      mailKeys: sendTaskDeadlineReminder.mock.calls.map((c) => c[0].idempotencyKey as string),
    };
  }

  it('east of UTC: every mark is said once, on its own business day — in-app and by mail', async () => {
    // 5 Nov 00:00 IST to 16 Nov 23:30 IST.
    const { messages, mailKeys } = await hourlyScans(
      KOLKATA,
      dueInKolkata,
      '2026-11-04T18:30:00.000Z',
      '2026-11-16T18:00:00.000Z',
    );
    expect(messages).toEqual([
      'Reminder: "Ship it" is due on Nov 13, 2026. 7 day(s) remaining.',
      'Reminder: "Ship it" is due on Nov 13, 2026. 3 day(s) remaining.',
      'Reminder: "Ship it" is due on Nov 13, 2026. 1 day(s) remaining.',
      'Reminder: "Ship it" is due today (Nov 13, 2026).',
      '"Ship it" is overdue by 1 day(s)',
      '"Ship it" is overdue by 2 day(s)',
      '"Ship it" is overdue by 3 day(s)',
    ]);
    expect(mailKeys).toEqual([
      'deadline:a1:TASK_DEADLINE_REMINDER:t1:2026-11-06',
      'deadline:a1:TASK_DEADLINE_REMINDER:t1:2026-11-10',
      'deadline:a1:TASK_DEADLINE_REMINDER:t1:2026-11-12',
      'deadline:a1:TASK_DEADLINE_REMINDER:t1:2026-11-13',
      'deadline:a1:TASK_OVERDUE:t1:2026-11-14',
      'deadline:a1:TASK_OVERDUE:t1:2026-11-15',
      'deadline:a1:TASK_OVERDUE:t1:2026-11-16',
    ]);
  });

  it('west of UTC, across the end of daylight saving: every mark once, on its own day', async () => {
    // Due 3 Nov (PST); the clocks go back on 1 Nov. 26 Oct 00:00 PDT to 5 Nov 23:00 PST.
    const { messages, mailKeys } = await hourlyScans(
      LOS_ANGELES,
      new Date('2026-11-03T08:00:00.000Z'),
      '2026-10-26T07:00:00.000Z',
      '2026-11-06T07:00:00.000Z',
    );
    expect(messages).toEqual([
      'Reminder: "Ship it" is due on Nov 3, 2026. 7 day(s) remaining.',
      'Reminder: "Ship it" is due on Nov 3, 2026. 3 day(s) remaining.',
      'Reminder: "Ship it" is due on Nov 3, 2026. 1 day(s) remaining.',
      'Reminder: "Ship it" is due today (Nov 3, 2026).',
      '"Ship it" is overdue by 1 day(s)',
      '"Ship it" is overdue by 2 day(s)',
    ]);
    expect(mailKeys.map((key) => key.slice(-10))).toEqual([
      '2026-10-27',
      '2026-10-31',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });
});

describe('DeadlineReminderService.runForWorkspace', () => {
  it('asserts membership before scanning', async () => {
    const { svc, assertMember, taskFindMany } = build();

    await svc.runForWorkspace(user, 'w1', NOW);

    expect(assertMember).toHaveBeenCalledWith(user, 'w1');
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('scans once per workspace per business day, however many members ask', async () => {
    const { svc, taskFindMany } = build({ tasks: [task()] });

    const first = await svc.runForWorkspace(user, 'w1', NOW);
    const second = await svc.runForWorkspace({ id: 'u2' } as User, 'w1', NOW);

    expect(first).toEqual({ scanned: true, created: 1 });
    expect(second).toEqual({ scanned: false, created: 0 });
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('scans again on the next business day', async () => {
    const { svc, taskFindMany } = build();

    await svc.runForWorkspace(user, 'w1', NOW);
    await svc.runForWorkspace(user, 'w1', at(1));

    expect(taskFindMany).toHaveBeenCalledTimes(2);
  });

  it('keys the day by the office’s calendar, not UTC’s', async () => {
    const { svc, taskFindMany } = build({ timezone: 'Asia/Kolkata' });

    // 12 Nov 22:30 IST, then 13 Nov 00:30 IST: one UTC day, two business days.
    await svc.runForWorkspace(user, 'w1', new Date('2026-11-12T17:00:00.000Z'));
    await svc.runForWorkspace(user, 'w1', new Date('2026-11-12T19:00:00.000Z'));
    expect(taskFindMany).toHaveBeenCalledTimes(2);

    // 13 Nov 06:30 IST: the next UTC day, the same business day.
    await svc.runForWorkspace(user, 'w1', new Date('2026-11-13T01:00:00.000Z'));
    expect(taskFindMany).toHaveBeenCalledTimes(2);
  });

  it('releases the day claim when the scan fails, so the next caller retries', async () => {
    const { svc, taskFindMany } = build();
    taskFindMany.mockRejectedValueOnce(new Error('db down'));

    await expect(svc.runForWorkspace(user, 'w1', NOW)).resolves.toEqual({
      scanned: false,
      created: 0,
    });
    await svc.runForWorkspace(user, 'w1', NOW);

    expect(taskFindMany).toHaveBeenCalledTimes(2);
  });

  it('propagates a membership denial instead of swallowing it', async () => {
    const { svc, assertMember } = build();
    assertMember.mockRejectedValue(new Error('Not found.'));

    await expect(svc.runForWorkspace(user, 'w1', NOW)).rejects.toThrow('Not found.');
  });
});
