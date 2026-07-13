import type { PrismaService } from '@strata/prisma';
import { SprintCompletedTaskRoller } from './task-roll.subscriber';

function prismaWith(count: number) {
  const updateMany = jest.fn().mockResolvedValue({ count });
  return { prisma: { task: { updateMany } } as unknown as PrismaService, updateMany };
}

describe('SprintCompletedTaskRoller', () => {
  it('detaches incomplete (status != DONE) tasks from the completed sprint', async () => {
    const { prisma, updateMany } = prismaWith(3);
    const roller = new SprintCompletedTaskRoller(prisma);
    expect(await roller.rollIncomplete('s1')).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { sprintId: 's1', status: { not: 'DONE' } },
      data: { sprintId: '' },
    });
  });

  it('onSprintCompleted rolls using the event payload sprintId', async () => {
    const { prisma, updateMany } = prismaWith(0);
    const roller = new SprintCompletedTaskRoller(prisma);
    await roller.onSprintCompleted({ payload: { workspaceId: 'w', projectId: 'p', sprintId: 's2' } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { sprintId: 's2', status: { not: 'DONE' } },
      data: { sprintId: '' },
    });
  });
});
