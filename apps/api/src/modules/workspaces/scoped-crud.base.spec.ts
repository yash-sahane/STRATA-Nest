import type { ListQuerySpec } from '@strata/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission, type PermissionKey } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { ScopedCrudService } from './scoped-crud.base';

type Row = { id: string; workspaceId: string; userId: string };

/** Stand-in for the personal collections (leave, attendance, time, notifications). */
class PersonalService extends ScopedCrudService<Row, Row> {
  protected readonly model = 'leaveRequest';
  protected readonly spec: ListQuerySpec = {
    filterable: {},
    sortable: {},
    defaultOrderBy: { createdAt: 'desc' },
  };
  protected readonly writePermission: PermissionKey = Permission.HrWrite;
  protected readonly ownerField: string | undefined = 'userId';
  protected readonly ownerOverridePermission: PermissionKey = Permission.LeaveApprove;
  protected map(row: Row) {
    return row;
  }
}

/** Stand-in for a workspace-owned collection: no ownerField, no row guard. */
class SharedService extends PersonalService {
  protected readonly ownerField = undefined;
}

/** Stand-in for the invitation collections: reads need a permission of their own. */
class GuardedReadService extends SharedService {
  protected readonly readPermission: PermissionKey = Permission.InviteManage;
}

const row: Row = { id: 'r1', workspaceId: 'w1', userId: 'owner' };

function build(opts: { canOverride?: boolean; platformAdmin?: boolean } = {}) {
  const update = jest.fn().mockResolvedValue(row);
  const remove = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    leaveRequest: { findFirst: jest.fn().mockResolvedValue(row), update, delete: remove },
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
    can: jest.fn().mockResolvedValue(opts.canOverride ?? false),
  } as unknown as WorkspaceAccessService;
  return { prisma, access, update, remove };
}

describe('ScopedCrudService row ownership', () => {
  const other = { id: 'intruder' } as User;
  const owner = { id: 'owner' } as User;

  it('blocks a member from updating another member’s personal row', async () => {
    const { prisma, access, update } = build();
    const svc = new PersonalService(prisma, access);
    await expect(svc.update(other, 'r1', { reason: 'x' })).rejects.toThrow(
      'You do not have permission to perform this action.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks a member from deleting another member’s personal row', async () => {
    const { prisma, access, remove } = build();
    const svc = new PersonalService(prisma, access);
    await expect(svc.remove(other, 'r1')).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('allows the owner of the row', async () => {
    const { prisma, access, update } = build();
    const svc = new PersonalService(prisma, access);
    await expect(svc.update(owner, 'r1', { reason: 'x' })).resolves.toEqual(row);
    expect(update).toHaveBeenCalled();
  });

  it('allows a non-owner holding the domain’s override permission (approvers)', async () => {
    const { prisma, access, update } = build({ canOverride: true });
    const svc = new PersonalService(prisma, access);
    await expect(svc.update(other, 'r1', { status: 'APPROVED' })).resolves.toEqual(row);
    expect(access.can).toHaveBeenCalledWith(other, 'w1', Permission.LeaveApprove);
    expect(update).toHaveBeenCalled();
  });

  it('allows platform admins', async () => {
    const { prisma, access } = build({ platformAdmin: true });
    const svc = new PersonalService(prisma, access);
    await expect(svc.update(other, 'r1', {})).resolves.toEqual(row);
  });

  it('is a no-op for workspace-owned collections (no ownerField)', async () => {
    const { prisma, access, update } = build();
    const svc = new SharedService(prisma, access);
    await expect(svc.update(other, 'r1', {})).resolves.toEqual(row);
    expect(update).toHaveBeenCalled();
  });
});

describe('ScopedCrudService readPermission', () => {
  const member = { id: 'member' } as User;

  /** Member of w1 and w2 but holding the read permission only in w2. */
  function buildGuarded(opts: { platformAdmin?: boolean } = {}) {
    const findFirst = jest.fn().mockResolvedValue(row);
    const prisma = { leaveRequest: { findFirst } } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1', 'w2'] } }),
      accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1', 'w2']),
      isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
      can: jest.fn().mockImplementation((_u, workspaceId: string) => workspaceId === 'w2'),
    } as unknown as WorkspaceAccessService;
    return { prisma, access, findFirst };
  }

  it('narrows reads to the workspaces where the caller holds it', async () => {
    const { prisma, access, findFirst } = buildGuarded();
    const svc = new GuardedReadService(prisma, access);
    await svc.retrieve(member, 'r1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { AND: [{ workspaceId: { in: ['w2'] } }, { id: 'r1' }] },
    });
  });

  it('leaves the plain membership scope alone for platform admins', async () => {
    const { prisma, access, findFirst } = buildGuarded({ platformAdmin: true });
    const svc = new GuardedReadService(prisma, access);
    await svc.retrieve(member, 'r1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { AND: [{ workspaceId: { in: ['w1', 'w2'] } }, { id: 'r1' }] },
    });
    expect(access.can).not.toHaveBeenCalled();
  });

  it('does not touch the scope of a collection that declares no readPermission', async () => {
    const { prisma, access, findFirst } = buildGuarded();
    const svc = new SharedService(prisma, access);
    await svc.retrieve(member, 'r1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { AND: [{ workspaceId: { in: ['w1', 'w2'] } }, { id: 'r1' }] },
    });
  });
});
