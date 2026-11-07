import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { TaskDeletionService } from '../deletion/task-deletion.service';

/**
 * Deleting a task takes it off the dependency lists of the tasks linked to it.
 * (The rest of the cascade is covered in deletion/deletion.service.spec.ts.)
 */
describe('TaskDeletionService — the edges of a deleted task', () => {
  const user = { id: 'u1' } as User;

  function deleting(linked: Array<{ id: string; blockedBy: unknown; blocks: unknown }>) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findMany = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve('OR' in args.where ? linked : []),
    );
    const none = () => ({
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    const tx = {
      task: { findMany, updateMany, deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      taskComment: none(),
      uploadedFile: none(),
    };
    const prisma = {
      task: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1',
          workspaceId: 'w1',
          projectId: 'p1',
          title: 'Gone',
          hierarchyId: 'P-T01',
          assigneeIds: [],
          functionalRequirementId: '',
          epicId: '',
        }),
      },
      // Its project takes changes (see project-archive).
      project: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      $transaction: (body: (t: unknown) => unknown) => body(tx),
    } as unknown as PrismaService;
    const sideEffects = { emitDeletes: jest.fn(), emitUpdates: jest.fn() };
    const access = { assertPermission: jest.fn().mockResolvedValue(undefined), isPlatformAdmin: () => true };
    const svc = new TaskDeletionService(prisma, access as never, sideEffects as never);
    return { svc, findMany, updateMany, sideEffects };
  }

  it('takes its id off both lists of every task that names it, before it goes', async () => {
    const { svc, findMany, updateMany } = deleting([
      { id: 't2', blockedBy: ['t1', 't9'], blocks: [] },
      { id: 't3', blockedBy: [], blocks: ['t1'] },
    ]);
    await svc.delete(user, 't1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'w1',
          OR: [{ blockedBy: { array_contains: ['t1'] } }, { blocks: { array_contains: ['t1'] } }],
        },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { blockedBy: ['t9'], blocks: [], version: { increment: 1 } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't3' },
      data: { blockedBy: [], blocks: [], version: { increment: 1 } },
    });
  });

  // updateMany stays out of the realtime hook, so their boards hear of it here,
  // after the commit — the count on their cards changed.
  it('tells every open board about the tasks it unlinked', async () => {
    const { svc, sideEffects } = deleting([{ id: 't2', blockedBy: ['t1'], blocks: [] }]);
    await svc.delete(user, 't1');
    expect(sideEffects.emitUpdates).toHaveBeenCalledWith([
      { collection: 'tasks', id: 't2', workspaceId: 'w1' },
    ]);
  });

  it('writes nothing to a task that does not actually name it', async () => {
    const { svc, updateMany } = deleting([{ id: 't2', blockedBy: ['t9'], blocks: 'not-a-list' }]);
    await svc.delete(user, 't1');
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 't2' } }));
  });
});
