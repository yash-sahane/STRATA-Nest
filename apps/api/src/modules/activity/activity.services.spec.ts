import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { SavedSearchesService } from './activity.services';

const stamp = new Date('2026-01-01T00:00:00.000Z');
const row = {
  id: 's1',
  workspaceId: 'w1',
  userId: 'owner',
  name: 'Mine',
  query: 'q',
  filters: {},
  createdAt: stamp,
  updatedAt: stamp,
};

function build() {
  const update = jest.fn().mockResolvedValue(row);
  const remove = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    savedSearch: { findFirst: jest.fn().mockResolvedValue(row), update, delete: remove },
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(false),
  } as unknown as WorkspaceAccessService;
  return { svc: new SavedSearchesService(prisma, access), update, remove };
}

describe('SavedSearchesService is owner-scoped', () => {
  const owner = { id: 'owner' } as User;
  const intruder = { id: 'intruder' } as User;

  it('blocks a member from editing another member’s saved search', async () => {
    const { svc, update } = build();

    // ActivityWrite is in the READ_ONLY baseline, so assertPermission passes for
    // every member — only the row guard stops this.
    await expect(svc.patch(intruder, 's1', { name: 'stolen' })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks a member from deleting another member’s saved search', async () => {
    const { svc, remove } = build();

    await expect(svc.remove(intruder, 's1')).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('still lets the owner edit their own', async () => {
    const { svc, update } = build();

    await svc.patch(owner, 's1', { name: 'renamed' });

    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { name: 'renamed' } });
  });
});
