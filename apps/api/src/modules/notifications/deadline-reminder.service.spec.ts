import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { DeadlineReminderService } from './deadline-reminder.service';

const NOW = new Date('2026-03-10T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const user = { id: 'u1' } as User;

type TaskRow = {
  id: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  assignedTo: unknown;
  assigneeIds: unknown;
};

function build(options: { tasks?: TaskRow[]; alreadySent?: Array<{ userId: string; type: string; relatedEntityId: string }>; emailAllowed?: boolean } = {}) {
  const taskFindMany = jest.fn().mockResolvedValue(options.tasks ?? []);
  const notificationFindMany = jest.fn().mockResolvedValue(options.alreadySent ?? []);
  const userFindMany = jest
    .fn()
    .mockResolvedValue([{ id: 'a1', email: 'a1@example.com', name: 'Ann' }]);
  const prisma = {
    task: { findMany: taskFindMany },
    notification: { findMany: notificationFindMany },
    user: { findMany: userFindMany },
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
  assignedTo: ['a1'],
  assigneeIds: [],
  ...over,
});

describe('DeadlineReminderService.scan', () => {
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

  it('de-duplicates a recipient listed in both assignedTo and assigneeIds', async () => {
    const { svc, deliver } = build({ tasks: [task({ assigneeIds: ['a1'] })] });

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
    const { svc, deliver } = build({ tasks: [task({ assignedTo: [null, 42, '', 'a1'] })] });

    await expect(svc.scan('w1', NOW)).resolves.toBe(1);
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ userId: 'a1' }));
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

describe('DeadlineReminderService.runForWorkspace', () => {
  it('asserts membership before scanning', async () => {
    const { svc, assertMember, taskFindMany } = build();

    await svc.runForWorkspace(user, 'w1', NOW);

    expect(assertMember).toHaveBeenCalledWith(user, 'w1');
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('scans once per workspace per UTC day, however many members ask', async () => {
    const { svc, taskFindMany } = build({ tasks: [task()] });

    const first = await svc.runForWorkspace(user, 'w1', NOW);
    const second = await svc.runForWorkspace({ id: 'u2' } as User, 'w1', NOW);

    expect(first).toEqual({ scanned: true, created: 1 });
    expect(second).toEqual({ scanned: false, created: 0 });
    expect(taskFindMany).toHaveBeenCalledTimes(1);
  });

  it('scans again on the next UTC day', async () => {
    const { svc, taskFindMany } = build();

    await svc.runForWorkspace(user, 'w1', NOW);
    await svc.runForWorkspace(user, 'w1', at(1));

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
