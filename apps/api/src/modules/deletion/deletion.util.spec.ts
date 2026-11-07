import type { DeletedEntity } from './deletion-side-effects.service';
import { detachTaskLinks, type TxLike } from './deletion.util';

/**
 * Deleting a project took its tasks with a bare deleteMany, so a task in
 * another project that depended on one of them kept the id — a "blocked by"
 * nothing could show or remove — and a sub-task under one kept a parent that
 * was gone. detachTaskLinks lets go of them first, as deleting one task does.
 */
function tx(linked: Array<{ id: string; blockedBy: unknown; blocks: unknown }>, orphans: string[] = []) {
  const findMany = jest.fn((args: { where: Record<string, unknown>; select: Record<string, unknown> }) =>
    Promise.resolve('blockedBy' in args.select ? linked : orphans.map((id) => ({ id }))),
  );
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  return { client: { task: { findMany, updateMany, deleteMany: jest.fn() } } as unknown as TxLike, findMany, updateMany };
}

describe('detachTaskLinks', () => {
  it('takes the removed tasks off every surviving task’s dependency lists, both ways round', async () => {
    const { client, updateMany } = tx([
      { id: 'keep-1', blockedBy: ['gone-a', 'other'], blocks: [] },
      { id: 'keep-2', blockedBy: [], blocks: ['gone-b'] },
      { id: 'keep-3', blockedBy: ['other'], blocks: ['also-other'] },
    ]);
    const touched: DeletedEntity[] = [];
    await detachTaskLinks(client, 'w1', ['gone-a', 'gone-b'], { projectId: { not: 'p1' } }, touched);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'keep-1' },
      data: { blockedBy: ['other'], blocks: [], version: { increment: 1 } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'keep-2' },
      data: { blockedBy: [], blocks: [], version: { increment: 1 } },
    });
    // A task whose links name none of them is left alone.
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'keep-3' } }));
    expect(touched.map((t) => t.id)).toEqual(['keep-1', 'keep-2']);
  });

  it('looks only at the tasks that stay, in the workspace', async () => {
    const { client, findMany } = tx([]);
    await detachTaskLinks(client, 'w1', ['gone-a'], { projectId: { not: 'p1' } }, []);
    expect(findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ workspaceId: 'w1', projectId: { not: 'p1' } }),
    );
  });

  it('a sub-task whose parent goes becomes a task of its own', async () => {
    const { client, updateMany } = tx([], ['child']);
    const touched: DeletedEntity[] = [];
    await detachTaskLinks(client, 'w1', ['gone-a'], { projectId: { not: 'p1' } }, touched);
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', projectId: { not: 'p1' }, parentTaskId: { in: ['gone-a'] } },
      data: { parentTaskId: '' },
    });
    expect(touched).toEqual([{ collection: 'tasks', id: 'child', workspaceId: 'w1' }]);
  });

  it('does nothing when nothing is removed', async () => {
    const { client, findMany } = tx([]);
    await detachTaskLinks(client, 'w1', [], {}, []);
    expect(findMany).not.toHaveBeenCalled();
  });
});
