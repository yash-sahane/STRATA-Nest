import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User, WorkspaceMember } from '@prisma/client';
import { permissionsForRole } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { WorkspaceMembersService } from './workspace-members.service';

const caller = { id: 'u1' } as User;

function member(over: Partial<WorkspaceMember> = {}): WorkspaceMember {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'm1',
    workspaceId: 'w1',
    userId: 'u2',
    role: 'MEMBER',
    status: 'ACTIVE',
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as WorkspaceMember;
}

function build(opts: {
  existing: WorkspaceMember;
  ownerId?: string;
  /** Other ACTIVE members whose role still holds the capability being counted. */
  otherManagers?: number;
  platformAdmin?: boolean;
  /** Custom WorkspaceRole rows of this workspace: name -> permission strings. */
  customRoles?: Record<string, string[]>;
}) {
  const update = jest.fn().mockImplementation(({ data }) => ({ ...opts.existing, ...data }));
  const remove = jest.fn().mockResolvedValue(undefined);
  const customRoles = opts.customRoles ?? {};
  const count = jest.fn().mockResolvedValue(opts.otherManagers ?? 1);
  // Adding or re-activating a membership settles any request that person had
  // raised to join, in the same commit where the write is transactional.
  const closeRequests = jest.fn().mockResolvedValue({ count: 1 });
  const create = jest.fn().mockReturnValue(member({ id: 'm-new', userId: 'u9' }));
  const prisma = {
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(opts.existing),
      count,
      create,
      update,
      delete: remove,
    },
    joinRequest: { updateMany: closeRequests },
    // Array form: the service reads the membership out of position 0.
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    workspaceRole: {
      findMany: jest
        .fn()
        .mockResolvedValue(Object.keys(customRoles).map((name) => ({ name }))),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: opts.ownerId ?? 'owner' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
    // Built-in roles resolve without touching the DB, so the real map is the
    // honest stand-in here; custom roles resolve from their stored JSON exactly
    // as WorkspaceAccessService.permissionsOfRole does.
    permissionsOfRole: jest
      .fn()
      .mockImplementation(async (_ws: string, role: string) =>
        permissionsForRole(role, customRoles[role]),
      ),
  } as unknown as WorkspaceAccessService;
  const events = { emit: jest.fn() } as unknown as EventEmitter2;
  return {
    svc: new WorkspaceMembersService(prisma, access, events),
    update,
    remove,
    access,
    count,
    create,
    closeRequests,
  };
}

describe('WorkspaceMembersService.create — a direct add answers the request to join', () => {
  it('closes the pending request in the same commit as the membership', async () => {
    const { svc, create, closeRequests } = build({ existing: member() });
    await svc.create(caller, { workspaceId: 'w1', userId: 'u9' });
    expect(create).toHaveBeenCalled();
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u9', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: caller.id },
    });
  });

  it('leaves the request pending for an INVITED membership, which grants nothing yet', async () => {
    const { svc, closeRequests } = build({ existing: member() });
    await svc.create(caller, { workspaceId: 'w1', userId: 'u9', status: 'INVITED' });
    expect(closeRequests).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.update — orphaned-workspace guards', () => {
  it('rejects deactivating your own membership (self-removal by another door)', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id }) });
    await expect(svc.update(caller, 'm1', { status: 'INACTIVE' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects changing your own role (self-demotion and self-promotion)', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id, role: 'MANAGER' }) });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects demoting or deactivating the workspace owner', async () => {
    const { svc } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    await expect(svc.update(caller, 'm1', { status: 'INACTIVE' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
  });

  it('rejects demoting the last active manager', async () => {
    const { svc } = build({ existing: member({ role: 'MANAGER' }), otherManagers: 0 });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
  });

  it('allows demoting a manager while another active manager remains', async () => {
    const { svc, update } = build({ existing: member({ role: 'MANAGER' }), otherManagers: 1 });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'MEMBER' } });
  });

  it('leaves a no-op write (same role, re-activation) ungated', async () => {
    const { svc, update } = build({
      existing: member({ userId: caller.id, status: 'INACTIVE' }),
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { status: 'ACTIVE' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('settles a pending join request when a membership is re-activated', async () => {
    // An INACTIVE membership is not an `activeMembership`, so its holder CAN
    // raise a join request; turning them back on answers it.
    const { svc, closeRequests } = build({
      existing: member({ userId: 'u2', status: 'INACTIVE' }),
    });
    await svc.update(caller, 'm1', { status: 'ACTIVE' });
    expect(closeRequests).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u2', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: caller.id },
    });
  });

  it('does not touch join requests on a write that grants no access', async () => {
    const { svc, closeRequests } = build({ existing: member({ role: 'MANAGER' }) });
    await svc.update(caller, 'm1', { role: 'MEMBER' });
    expect(closeRequests).not.toHaveBeenCalled();
  });

  it('rejects a status outside the three the app models', async () => {
    const { svc } = build({ existing: member() });
    await expect(svc.update(caller, 'm1', { status: 'suspended' })).rejects.toThrow(
      'Unknown membership status "suspended".',
    );
  });

  it('validates the role name against the workspace before writing it', async () => {
    const { svc, access } = build({ existing: member() });
    await svc.update(caller, 'm1', { role: 'MANAGER' });
    expect(access.assertValidRole).toHaveBeenCalledWith('w1', 'MANAGER');
  });

  it('PROMOTES the owner instead of refusing: the orphan guards are for privilege LOSS', async () => {
    // The workspace's own owner sits on a non-manager role (a legacy label the
    // normalize migration mapped to MEMBER), so the workspace has no manager at
    // all. Repairing it must not be read as "demoting the owner".
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MEMBER' }),
      ownerId: 'owner',
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'MANAGER' } });
  });

  it('lets a platform admin repair a workspace whose last manager is the owner', async () => {
    // MEMBER, not ASSISTANT_MANAGER: the demotion has to actually cost the
    // workspace both capabilities, or the exemption is never exercised.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
      otherManagers: 0,
      platformAdmin: true,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('refuses MANAGER -> ASSISTANT_MANAGER on the owner: it strips workspace:delete', async () => {
    // ASSISTANT_MANAGER is `ALL` minus workspace:delete, so it KEEPS member:update.
    // Treating member:update as the only admin capability let this demotion skip
    // the owner guard entirely and leave the workspace with nobody able to delete it.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
    });
    await expect(svc.update(caller, 'm1', { role: 'ASSISTANT_MANAGER' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a custom role that keeps member:update but drops workspace:delete', async () => {
    // The attacker mints `Ghost` with exactly the permission the old guard keyed
    // on, then patches the owner onto it. Capability is resolved from the stored
    // JSON, so the disguise does not work.
    const { svc, update } = build({
      existing: member({ userId: 'owner', role: 'MANAGER' }),
      ownerId: 'owner',
      customRoles: { Ghost: ['member:update'] },
    });
    await expect(svc.update(caller, 'm1', { role: 'Ghost' })).rejects.toThrow(
      'The workspace owner cannot be demoted.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('protects the last admin of a workspace administered through a CUSTOM role', async () => {
    // No membership anywhere carries the literal string 'MANAGER', so the old
    // `role: 'MANAGER'` count query never ran and this workspace had no
    // last-admin protection at all.
    const { svc } = build({
      existing: member({ role: 'Owner' }),
      customRoles: { Owner: ['member:update', 'workspace:delete'] },
      otherManagers: 0,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).rejects.toThrow(
      'The last manager of a workspace cannot be demoted.',
    );
  });

  it('counts capability holders by role, not by the literal name MANAGER', async () => {
    // Demoting the last MANAGER is fine when a custom role in the workspace
    // still resolves to the same capabilities.
    const { svc, update, count } = build({
      existing: member({ role: 'MANAGER' }),
      customRoles: { Steward: ['member:update', 'workspace:delete'] },
      otherManagers: 1,
    });
    await expect(svc.update(caller, 'm1', { role: 'MEMBER' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
    // The `in` set is capability-derived and includes the custom role.
    const where = count.mock.calls[0][0].where as { role: { in: string[] } };
    expect(where.role.in).toEqual(expect.arrayContaining(['MANAGER', 'Steward']));
  });

  it('still refuses a SELF-promotion, which the privilege-loss test alone would miss', async () => {
    const { svc, update } = build({ existing: member({ userId: caller.id, role: 'MEMBER' }) });
    await expect(svc.update(caller, 'm1', { role: 'MANAGER' })).rejects.toThrow(
      'You cannot change your own role or status.',
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('WorkspaceMembersService.remove — unchanged invariants', () => {
  it('still refuses the owner, the caller and the last manager', async () => {
    const owner = build({ existing: member({ userId: 'owner' }), ownerId: 'owner' });
    await expect(owner.svc.remove(caller, 'm1')).rejects.toThrow(
      'The workspace owner cannot be removed.',
    );

    const self = build({ existing: member({ userId: caller.id }) });
    await expect(self.svc.remove(caller, 'm1')).rejects.toThrow(
      'You cannot remove your own membership.',
    );

    const last = build({ existing: member({ role: 'MANAGER' }), otherManagers: 0 });
    await expect(last.svc.remove(caller, 'm1')).rejects.toThrow(
      'The last manager of a workspace cannot be removed.',
    );
  });

  it('removes an ordinary member', async () => {
    const { svc, remove } = build({ existing: member() });
    await expect(svc.remove(caller, 'm1')).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
