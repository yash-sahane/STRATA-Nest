import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type PrismaService,
  clientRequirementRollup,
  deriveEpicRollup,
  epicRollup,
  requirementRollup,
} from '@strata/prisma';
import type { FunctionalRequirement, User } from '@prisma/client';
import { RequirementTasks, startOfDayIn } from './requirement-tasks';

const actor = { id: 'u1', name: 'Planner', email: 'planner@example.test' } as User;

const requirement = {
  id: 'fr1',
  workspaceId: 'w1',
  projectId: 'p1',
  hierarchyId: 'PAY-FR-01',
  epicId: 'e1',
  sprintId: 's1',
  title: 'Pay by card',
  description: 'Take a card payment at checkout.',
  priority: 'HIGH',
  assigneeIds: ['u2', 'gone'],
} as unknown as FunctionalRequirement;

const sprintEnd = new Date('2026-10-20T00:00:00.000Z');
/**
 * The sprint's last day as the workspace reads a due day: its office is in New
 * York (EDT, UTC-4, in October), where 20 October begins at 04:00 UTC. The
 * stored UTC midnight is 19 October there.
 */
const dueOnSprintEnd = new Date('2026-10-20T04:00:00.000Z');
const NAMES: Record<string, string> = { u2: 'Dev', u3: 'Tester', u4: 'Designer' };

/**
 * `tasks` are the requirement's own. The double answers the mover's three kinds
 * of read — ids matching a filter, a count, whole rows by id — from that list.
 */
function build(
  tasks: Array<{
    id: string;
    status: string;
    sprintId: string;
    epicId?: string;
    assigneeIds?: string[];
  }>,
  sprint: { status: string; endDate: Date | null } | null = { status: 'PLANNING', endDate: sprintEnd },
) {
  const matches = (task: (typeof tasks)[number], where: Record<string, unknown>): boolean => {
    if (typeof where.sprintId === 'string' && task.sprintId !== where.sprintId) return false;
    if (typeof where.epicId === 'string' && (task.epicId ?? '') !== where.epicId) return false;
    const status = where.status as { not?: string } | string | undefined;
    if (typeof status === 'string' && task.status !== status) return false;
    if (status && typeof status === 'object' && status.not && task.status === status.not) return false;
    const ids = (where.id as { in?: string[] } | undefined)?.in;
    if (ids && !ids.includes(task.id)) return false;
    return true;
  };
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const update = jest.fn().mockResolvedValue({});
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data));
  const announceWrite = jest.fn();
  const emit = jest.fn();
  const requirementUpdate = jest.fn().mockResolvedValue({});
  const epicUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    sprint: { findUnique: jest.fn().mockResolvedValue(sprint) },
    task: {
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.projectId ? 7 : tasks.filter((t) => matches(t, where)).length),
      ),
      // The position probe: the board's last card sits at 6, so a new task goes at 7.
      aggregate: jest.fn().mockResolvedValue({ _max: { position: 6 } }),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(tasks.filter((t) => matches(t, where))),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany,
      update,
      create,
    },
    // Everybody but 'gone' is still an active member.
    workspaceMember: {
      findMany: jest.fn(({ where }: { where: { userId: { in: string[] } } }) =>
        Promise.resolve(where.userId.in.filter((id) => id !== 'gone').map((userId) => ({ userId }))),
      ),
    },
    user: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) => ({ id, name: NAMES[id] ?? '', email: `${id}@example.test` })),
        ),
      ),
    },
    functionalRequirement: {
      findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT', progress: 0 }),
      update: requirementUpdate,
      // An epic's roll-up also counts its requirements that have no task yet.
      findMany: jest.fn().mockResolvedValue([]),
    },
    epic: {
      findUnique: jest.fn().mockResolvedValue({ status: 'DONE', progress: 100 }),
      update: epicUpdate,
    },
    // The business timezone a due day is read in.
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ settings: { timezone: 'America/New_York' } }),
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    // A requirement's moves are one transaction of updateMany calls.
    $transaction: jest.fn((writes: Promise<unknown>[]) => Promise.all(writes)),
    announceWrite,
  } as unknown as PrismaService;
  const mover = new RequirementTasks(prisma, { emit } as unknown as EventEmitter2);
  return {
    mover,
    prisma,
    updateMany,
    update,
    create,
    announceWrite,
    emit,
    requirementUpdate,
    epicUpdate,
  };
}

const writes = (updateMany: jest.Mock) =>
  updateMany.mock.calls.map(([args]) => args as { where: Record<string, unknown>; data: Record<string, unknown> });

describe('RequirementTasks.followSprint — into a sprint', () => {
  it('takes the open tasks along and leaves the finished one where it was delivered', async () => {
    const { mover, updateMany, announceWrite } = build([
      { id: 'open', status: 'TODO', sprintId: '' },
      { id: 'done', status: 'DONE', sprintId: 's0' },
    ]);
    await mover.followSprint(actor, requirement, '');
    expect(writes(updateMany)[0]).toEqual({
      where: { id: { in: ['open'] } },
      data: { sprintId: 's1', version: { increment: 1 } },
    });
    // A bulk write is invisible to the realtime hook, so the row is handed over.
    expect(announceWrite).toHaveBeenCalledTimes(1);
    expect(announceWrite).toHaveBeenCalledWith('Task', 'update', expect.objectContaining({ id: 'open' }));
  });

  // It used to be written over every task, every time the requirement was
  // planned, so a date agreed with a client was replaced without a word.
  it('gives the sprint’s end as a deadline only to a task that had none', async () => {
    const { mover, updateMany } = build([{ id: 'open', status: 'TODO', sprintId: '' }]);
    await mover.followSprint(actor, requirement, '');
    expect(writes(updateMany)[1]).toEqual({
      where: { id: { in: ['open'] }, dueDate: null },
      data: { dueDate: dueOnSprintEnd, version: { increment: 1 } },
    });
  });

  // Written as the stored UTC midnight, it was the day BEFORE the sprint's end
  // for every office west of UTC.
  it('makes the task due on the sprint’s last day as the workspace’s office reads it', async () => {
    const { mover, updateMany, prisma } = build([{ id: 'open', status: 'TODO', sprintId: '' }]);
    (prisma.workspace.findUnique as jest.Mock).mockResolvedValue({
      settings: { timezone: 'Asia/Kolkata' },
    });
    await mover.followSprint(actor, requirement, '');
    expect(writes(updateMany)[1].data.dueDate).toEqual(new Date('2026-10-19T18:30:00.000Z'));
  });

  it('puts backlog tasks on the board when the sprint is already running', async () => {
    const { mover, updateMany } = build(
      [{ id: 'open', status: 'BACKLOG', sprintId: '' }],
      { status: 'ACTIVE', endDate: null },
    );
    await mover.followSprint(actor, requirement, '');
    expect(writes(updateMany)).toEqual([
      { where: { id: { in: ['open'] } }, data: { sprintId: 's1', version: { increment: 1 } } },
      {
        where: { id: { in: ['open'] }, status: 'BACKLOG' },
        data: { status: 'TODO', version: { increment: 1 } },
      },
    ]);
  });

  it('leaves statuses alone in a sprint that has not started', async () => {
    const { mover, updateMany } = build([{ id: 'open', status: 'BACKLOG', sprintId: '' }]);
    await mover.followSprint(actor, requirement, '');
    expect(writes(updateMany).some((w) => w.data.status !== undefined)).toBe(false);
  });
});

describe('RequirementTasks.followSprint — a requirement with no tasks', () => {
  it('becomes one task: the requirement itself, in the sprint, for the people on it', async () => {
    const { mover, create, emit } = build([]);
    await mover.followSprint(actor, requirement, '');
    expect(create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'w1',
      projectId: 'p1',
      hierarchyId: 'PAY-FR-01-PAY-01',
      functionalRequirementId: 'fr1',
      sprintId: 's1',
      epicId: 'e1',
      title: 'Pay by card',
      status: 'BACKLOG',
      priority: 'HIGH',
      dueDate: dueOnSprintEnd,
      // 'gone' has left the workspace: the task is not handed to nobody.
      assigneeIds: ['u2'],
      assigneeNames: ['Dev'],
      assignedBy: 'u1',
      createdById: 'u1',
    });
    // The person it is assigned to is told, as for any other task.
    expect(emit).toHaveBeenCalledWith(
      'task.assigned',
      expect.objectContaining({ payload: expect.objectContaining({ assigneeIds: ['u2'] }) }),
    );
  });

  it('starts at To Do when the sprint is already running', async () => {
    const { mover, create } = build([], { status: 'ACTIVE', endDate: sprintEnd });
    await mover.followSprint(actor, requirement, '');
    expect(create.mock.calls[0][0].data.status).toBe('TODO');
  });

  it('takes the next free id when the natural one is in use', async () => {
    const { mover, create, prisma } = build([]);
    (prisma.task.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'other' });
    await mover.followSprint(actor, requirement, '');
    expect(create.mock.calls[0][0].data.hierarchyId).toBe('PAY-FR-01-PAY-02');
  });

  it('moves the requirement off "draft" and re-sums its epic', async () => {
    const { mover, requirementUpdate, epicUpdate, prisma } = build([]);
    // Once created, the requirement has one task and so does the epic.
    (prisma.task.count as jest.Mock).mockImplementation(
      ({ where }: { where: { status?: unknown; projectId?: unknown } }) =>
        Promise.resolve(where.projectId ? 7 : where.status === undefined ? 1 : 0),
    );
    (prisma.task.count as jest.Mock).mockResolvedValueOnce(0); // "has it any tasks?"
    await mover.followSprint(actor, requirement, '');
    expect(requirementUpdate).toHaveBeenCalledWith({
      where: { id: 'fr1' },
      data: { progress: 0, status: 'APPROVED', version: { increment: 1 } },
    });
    expect(epicUpdate).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { progress: 0, status: 'TODO', version: { increment: 1 } },
    });
  });
});

describe('RequirementTasks.followSprint — out of a sprint', () => {
  const unplanned = { ...requirement, sprintId: '' } as FunctionalRequirement;

  it('takes out the open tasks that were in the sprint it left, and only those', async () => {
    const { mover, updateMany, create } = build([
      { id: 'there', status: 'TODO', sprintId: 's1' },
      // Delivered in s1: taking it out erased it from the sprint's velocity and
      // from what the sprint recorded when it closed. It stays.
      { id: 'finished-there', status: 'DONE', sprintId: 's1' },
      // Somebody moved this one to another sprint by hand; it stays.
      { id: 'elsewhere', status: 'TODO', sprintId: 's9' },
    ]);
    await mover.followSprint(actor, unplanned, 's1');
    expect(writes(updateMany)).toEqual([
      {
        where: { id: { in: ['there'] } },
        data: { sprintId: '', version: { increment: 1 } },
      },
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it('moves nothing when all of its work in the sprint is finished', async () => {
    const { mover, updateMany, announceWrite } = build([
      { id: 'finished-there', status: 'DONE', sprintId: 's1' },
    ]);
    await mover.followSprint(actor, unplanned, 's1');
    expect(updateMany).not.toHaveBeenCalled();
    expect(announceWrite).not.toHaveBeenCalled();
  });

  it('does nothing for a requirement that was never in one', async () => {
    const { mover, updateMany } = build([{ id: 'a', status: 'TODO', sprintId: '' }]);
    await mover.followSprint(actor, unplanned, '');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('RequirementTasks.followEpic', () => {
  it('moves the tasks that were under the epic it left, and re-sums both epics', async () => {
    const moved = { ...requirement, epicId: 'e2' } as FunctionalRequirement;
    const { mover, updateMany, prisma } = build([
      { id: 'a', status: 'TODO', sprintId: '', epicId: 'e1' },
      // Filed under a third epic on purpose; it stays there.
      { id: 'b', status: 'TODO', sprintId: '', epicId: 'e7' },
    ]);
    await mover.followEpic(moved, 'e1');
    expect(writes(updateMany)).toEqual([
      { where: { id: { in: ['a'] } }, data: { epicId: 'e2', version: { increment: 1 } } },
    ]);
    const summed = (prisma.epic.findUnique as jest.Mock).mock.calls.map(
      ([args]) => (args as { where: { id: string } }).where.id,
    );
    expect(summed).toEqual(['e1', 'e2']);
  });
});

describe('RequirementTasks.followAssignees', () => {
  const on = (...assigneeIds: string[]) => ({ ...requirement, assigneeIds }) as unknown as FunctionalRequirement;
  const changed = (update: jest.Mock) =>
    Object.fromEntries(
      update.mock.calls.map(([args]) => {
        const { where, data } = args as { where: { id: string }; data: { assigneeIds: string[] } };
        return [where.id, data.assigneeIds];
      }),
    );

  // Both assigning screens used to write the requirement's whole list over
  // every task under it.
  it('a task given to one person keeps them when somebody joins the requirement', async () => {
    const { mover, update } = build([
      { id: 'following', status: 'TODO', sprintId: 's1', assigneeIds: ['u2', 'u3'] },
      { id: 'own', status: 'TODO', sprintId: 's1', assigneeIds: ['u3'] },
    ]);
    await mover.followAssignees(actor, on('u2', 'u3', 'u4'), ['u2', 'u3']);
    // The task that had the requirement's people follows it; the other is untouched.
    expect(changed(update)).toEqual({ following: ['u2', 'u3', 'u4'] });
    expect(update.mock.calls[0][0].data).toMatchObject({
      assigneeNames: ['Dev', 'Tester', 'Designer'],
      assignedBy: 'u1',
      version: { increment: 1 },
    });
  });

  it('somebody taken off the requirement comes off its open tasks, whoever gave them', async () => {
    const { mover, update } = build([
      { id: 'following', status: 'TODO', sprintId: 's1', assigneeIds: ['u2', 'u3'] },
      { id: 'own', status: 'IN_PROGRESS', sprintId: 's1', assigneeIds: ['u3', 'u4'] },
    ]);
    await mover.followAssignees(actor, on('u2'), ['u2', 'u3']);
    expect(changed(update)).toEqual({ following: ['u2'], own: ['u4'] });
  });

  it('an unassigned task under an unassigned requirement gets its first people', async () => {
    const { mover, update } = build([
      { id: 'empty', status: 'BACKLOG', sprintId: '', assigneeIds: [] },
      { id: 'own', status: 'BACKLOG', sprintId: '', assigneeIds: ['u4'] },
    ]);
    await mover.followAssignees(actor, on('u2'), []);
    expect(changed(update)).toEqual({ empty: ['u2'] });
  });

  it('leaves finished work with whoever did it', async () => {
    const { mover, update } = build([
      { id: 'done', status: 'DONE', sprintId: 's1', assigneeIds: ['u2', 'u3'] },
    ]);
    await mover.followAssignees(actor, on('u2'), ['u2', 'u3']);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not hand a task to somebody who has left the workspace', async () => {
    const { mover, update } = build([
      { id: 'following', status: 'TODO', sprintId: 's1', assigneeIds: ['u2'] },
    ]);
    await mover.followAssignees(actor, on('u2', 'gone'), ['u2']);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('the roll-up rules', () => {
  const counts = (total: number, done: number, underway: number) => ({ total, done, underway });

  it('a requirement is planned, in progress, then "tasks done" — by its tasks', () => {
    expect(requirementRollup(counts(3, 0, 0), 'DRAFT')).toEqual({ progress: 0, status: 'APPROVED' });
    expect(requirementRollup(counts(3, 0, 1), 'APPROVED')).toEqual({ progress: 0, status: 'IMPLEMENTED' });
    expect(requirementRollup(counts(3, 3, 0), 'IMPLEMENTED')).toEqual({ progress: 100, status: 'TESTED' });
  });

  it('a requirement somebody signed off stays signed off while its work is finished', () => {
    expect(requirementRollup(counts(3, 3, 0), 'DEPLOYED').status).toBe('DEPLOYED');
    expect(requirementRollup(counts(0, 0, 0), 'DEPLOYED').status).toBe('DEPLOYED');
  });

  it('new work under a signed-off requirement reopens it', () => {
    expect(requirementRollup(counts(4, 3, 0), 'DEPLOYED')).toEqual({ progress: 75, status: 'APPROVED' });
    expect(requirementRollup(counts(4, 3, 1), 'DEPLOYED').status).toBe('IMPLEMENTED');
  });

  // An epic's work is its tasks and the requirements in it that have none yet.
  it('an epic is not done while a requirement in it has not been started', async () => {
    const client = (requirements: { id: string; status: string }[], withTasks: string[]) =>
      ({
        task: {
          count: jest.fn((args: { where: { status?: unknown } }) =>
            Promise.resolve(args.where.status === 'DONE' ? 2 : args.where.status ? 0 : 2),
          ),
          findMany: jest.fn().mockResolvedValue(withTasks.map((id) => ({ functionalRequirementId: id }))),
        },
        functionalRequirement: { findMany: jest.fn().mockResolvedValue(requirements) },
        epic: {},
      }) as unknown as Parameters<typeof deriveEpicRollup>[0];
    // Two tasks done under the first requirement; the second has no task at all.
    const open = await deriveEpicRollup(
      client([{ id: 'f1', status: 'TESTED' }, { id: 'f2', status: 'DRAFT' }], ['f1']),
      'e1',
    );
    expect(open).toEqual({ progress: 67, status: 'IN_PROGRESS' });
    // Signed off without tasks, it counts as finished work.
    const signed = await deriveEpicRollup(
      client([{ id: 'f1', status: 'TESTED' }, { id: 'f2', status: 'DEPLOYED' }], ['f1']),
      'e1',
    );
    expect(signed).toEqual({ progress: 100, status: 'DONE' });
  });

  it('a requirement with no tasks keeps the status a person gave it', () => {
    expect(requirementRollup(counts(0, 0, 0), 'REVIEW')).toEqual({ progress: 0, status: 'REVIEW' });
    expect(requirementRollup(counts(0, 0, 0), '').status).toBe('DRAFT');
  });

  it('"all done" is a count: 240 of 241 rounds to 100% and is not finished', () => {
    expect(requirementRollup(counts(241, 240, 0), 'IMPLEMENTED')).toEqual({ progress: 100, status: 'APPROVED' });
    expect(epicRollup(counts(241, 240, 0))).toEqual({ progress: 100, status: 'IN_PROGRESS' });
  });

  it('an epic is in progress as soon as anything under it has started', () => {
    expect(epicRollup(counts(4, 0, 0)).status).toBe('TODO');
    expect(epicRollup(counts(4, 0, 1)).status).toBe('IN_PROGRESS');
    expect(epicRollup(counts(4, 4, 0)).status).toBe('DONE');
    expect(epicRollup(counts(0, 0, 0))).toEqual({ progress: 0, status: 'TODO' });
  });
});

describe('a client requirement follows the work raised from it', () => {
  const fr = (status: string, progress = 0) => ({ status, progress });

  it('once approved: In Progress when any of it has started, Completed when all is signed off', () => {
    expect(clientRequirementRollup([fr('APPROVED'), fr('DRAFT')], 'APPROVED')).toBe('APPROVED');
    expect(clientRequirementRollup([fr('IMPLEMENTED'), fr('APPROVED')], 'APPROVED')).toBe('IN_PROGRESS');
    // A task finished under a requirement is a start, whatever its status reads.
    expect(clientRequirementRollup([fr('APPROVED', 50), fr('DRAFT')], 'APPROVED')).toBe('IN_PROGRESS');
    // Tested is done work awaiting sign-off: still in progress.
    expect(clientRequirementRollup([fr('TESTED', 100), fr('DEPLOYED', 100)], 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(clientRequirementRollup([fr('DEPLOYED', 100), fr('DEPLOYED')], 'IN_PROGRESS')).toBe('COMPLETED');
  });

  it('work reopened under a completed request takes it back to In Progress', () => {
    expect(clientRequirementRollup([fr('DEPLOYED'), fr('IMPLEMENTED')], 'COMPLETED')).toBe('IN_PROGRESS');
    expect(clientRequirementRollup([fr('DEPLOYED'), fr('APPROVED')], 'COMPLETED')).toBe('IN_PROGRESS');
  });

  it("drafting, submitting and archiving are people's decisions, and so is one with no work", () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'ARCHIVED']) {
      expect(clientRequirementRollup([fr('DEPLOYED')], status)).toBe(status);
    }
    expect(clientRequirementRollup([], 'COMPLETED')).toBe('COMPLETED');
  });
});

describe('startOfDayIn — the instant a due day begins in the business timezone', () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('is local midnight on either side of UTC', () => {
    expect(startOfDayIn(day('2026-10-20'), 'Asia/Kolkata').toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(startOfDayIn(day('2026-10-20'), 'America/New_York').toISOString()).toBe('2026-10-20T04:00:00.000Z');
    expect(startOfDayIn(day('2026-10-20'), 'UTC').toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('follows the offset of the day itself, not the one at UTC midnight', () => {
    // Sydney moves to daylight time at 02:00 on 4 October 2026: by UTC midnight
    // it is already UTC+11, but its own midnight was still UTC+10.
    expect(startOfDayIn(day('2026-10-04'), 'Australia/Sydney').toISOString()).toBe('2026-10-03T14:00:00.000Z');
    // New York leaves daylight time on 1 November 2026: that day began at UTC-4.
    expect(startOfDayIn(day('2026-11-01'), 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(startOfDayIn(day('2026-11-02'), 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('is the first instant of the day where the clocks change at midnight', () => {
    // Santiago's clocks jump from 00:00 to 01:00 when daylight time starts, so
    // that day has no midnight: it begins at whatever instant first falls on it.
    const begins = startOfDayIn(day('2026-09-06'), 'America/Santiago');
    const local = (at: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(at);
    expect(local(begins)).toBe('2026-09-06');
    expect(local(new Date(begins.getTime() - 1))).toBe('2026-09-05');
  });
});
