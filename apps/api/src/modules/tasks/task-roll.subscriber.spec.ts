import type { PrismaService } from '@strata/prisma';
import { SprintCompletedTaskRoller } from './task-roll.subscriber';

function prismaWith(
  count: number,
  opts: {
    /** Functional requirements planned into the sprint. */
    requirements?: Array<{ id: string; status: string }>;
    /** Every task of those requirements, whichever sprint it is in. */
    tasks?: Array<{ functionalRequirementId: string; status: string }>;
    /** The tasks a roll or a start will move. */
    moving?: Array<{ id: string }>;
  } = {},
) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  const announceWrite = jest.fn();
  const rollRequirements = jest
    .fn()
    .mockImplementation(({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    }));
  const prisma = {
    task: {
      updateMany,
      // Three questions reach findMany: which tasks to move (selects the id
      // alone), the moved rows to announce (by id), and the requirements' tasks.
      findMany: jest.fn((args: { where?: { id?: unknown }; select?: { id?: boolean } }) =>
        Promise.resolve(
          args?.select?.id || args?.where?.id ? (opts.moving ?? []) : (opts.tasks ?? []),
        ),
      ),
    },
    announceWrite,
    functionalRequirement: {
      findMany: jest.fn().mockResolvedValue(opts.requirements ?? []),
      updateMany: rollRequirements,
    },
  } as unknown as PrismaService;
  return { prisma, updateMany, rollRequirements, announceWrite };
}

describe('SprintCompletedTaskRoller', () => {
  it('detaches incomplete (status != DONE) tasks from the completed sprint', async () => {
    const moving = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
    const { prisma, updateMany, announceWrite } = prismaWith(3, { moving });
    const roller = new SprintCompletedTaskRoller(prisma);
    expect(await roller.rollIncomplete('s1')).toBe(3);
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { sprintId: 's1', status: { not: 'DONE' } },
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2', 't3'] } },
      data: { sprintId: '', version: { increment: 1 } },
    });
    // A bulk write is invisible to the realtime hook; each moved task is
    // handed to it, or an open board keeps the card until it is reloaded.
    expect(announceWrite).toHaveBeenCalledTimes(3);
    expect(announceWrite).toHaveBeenCalledWith('Task', 'update', { id: 't1' });
  });

  it('onSprintCompleted rolls using the event payload sprintId', async () => {
    const { prisma, updateMany } = prismaWith(0);
    const roller = new SprintCompletedTaskRoller(prisma);
    await roller.onSprintCompleted({ payload: { workspaceId: 'w', projectId: 'p', sprintId: 's2' } });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { sprintId: 's2', status: { not: 'DONE' } },
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [] } },
      data: { sprintId: '', version: { increment: 1 } },
    });
  });

  it('onSprintStarted puts the sprint’s backlog tasks on the board, and says so', async () => {
    const { prisma, updateMany, announceWrite } = prismaWith(1, { moving: [{ id: 't9' }] });
    const roller = new SprintCompletedTaskRoller(prisma);
    await roller.onSprintStarted({ payload: { workspaceId: 'w', projectId: 'p', sprintId: 's3' } });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { sprintId: 's3', status: 'BACKLOG' },
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['t9'] } },
      data: { status: 'TODO', version: { increment: 1 } },
    });
    expect(announceWrite).toHaveBeenCalledWith('Task', 'update', { id: 't9' });
  });
});

describe('SprintCompletedTaskRoller — requirements follow their unfinished tasks', () => {
  it('returns a requirement to the backlog when any of its tasks is still open', async () => {
    const { prisma, rollRequirements } = prismaWith(0, {
      requirements: [
        { id: 'open', status: 'IMPLEMENTED' },
        { id: 'done', status: 'TESTED' },
      ],
      tasks: [
        { functionalRequirementId: 'open', status: 'DONE' },
        { functionalRequirementId: 'open', status: 'IN_PROGRESS' },
        { functionalRequirementId: 'done', status: 'DONE' },
      ],
    });
    const roller = new SprintCompletedTaskRoller(prisma);
    expect(await roller.rollUnfinishedRequirements('s1')).toBe(1);
    // The finished one stays on the sprint it was delivered in.
    expect(rollRequirements).toHaveBeenCalledWith({
      where: { id: { in: ['open'] } },
      data: { sprintId: '' },
    });
  });

  it('goes by the requirement’s own status when it has no tasks at all', async () => {
    const { prisma, rollRequirements } = prismaWith(0, {
      requirements: [
        { id: 'untouched', status: 'APPROVED' },
        { id: 'shipped', status: 'DEPLOYED' },
      ],
    });
    const roller = new SprintCompletedTaskRoller(prisma);
    expect(await roller.rollUnfinishedRequirements('s1')).toBe(1);
    expect(rollRequirements).toHaveBeenCalledWith({
      where: { id: { in: ['untouched'] } },
      data: { sprintId: '' },
    });
  });

  it('writes nothing when everything planned was finished', async () => {
    const { prisma, rollRequirements } = prismaWith(0, {
      requirements: [{ id: 'done', status: 'TESTED' }],
      tasks: [{ functionalRequirementId: 'done', status: 'DONE' }],
    });
    const roller = new SprintCompletedTaskRoller(prisma);
    expect(await roller.rollUnfinishedRequirements('s1')).toBe(0);
    expect(rollRequirements).not.toHaveBeenCalled();
  });

  it('runs as part of completing the sprint', async () => {
    const { prisma, rollRequirements } = prismaWith(2, {
      requirements: [{ id: 'open', status: 'APPROVED' }],
      tasks: [{ functionalRequirementId: 'open', status: 'TODO' }],
    });
    const roller = new SprintCompletedTaskRoller(prisma);
    await roller.onSprintCompleted({ payload: { workspaceId: 'w', projectId: 'p', sprintId: 's1' } });
    expect(rollRequirements).toHaveBeenCalledTimes(1);
  });
});
