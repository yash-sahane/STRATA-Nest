import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from './permissions';
import { WorkspaceAccessService } from './workspace-access.service';

function user(over: Partial<User> = {}): User {
  return { id: 'u1', isSuperuser: false, isAdminFlag: false, ...over } as User;
}

function makePrisma(opts: {
  memberships?: Array<{ workspaceId: string }>;
  membership?: { role: string } | null;
  role?: { permissions: unknown } | null;
}): PrismaService {
  return {
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue(opts.memberships ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.membership ?? null),
    },
    workspaceRole: {
      findFirst: jest.fn().mockResolvedValue(opts.role ?? null),
    },
  } as unknown as PrismaService;
}

const config = (rbac: boolean): ConfigService =>
  ({ get: (k: string, d?: unknown) => (k === 'RBAC_ENFORCED' ? rbac : d) }) as unknown as ConfigService;

describe('WorkspaceAccessService', () => {
  it('platform admin accesses all workspaces (null ids, empty scope)', async () => {
    const svc = new WorkspaceAccessService(makePrisma({}), config(false));
    expect(await svc.accessibleWorkspaceIds(user({ isAdminFlag: true }))).toBeNull();
    expect(await svc.scopeWhere(user({ isAdminFlag: true }))).toEqual({});
  });

  it('member scope lists their ACTIVE workspace ids', async () => {
    const svc = new WorkspaceAccessService(
      makePrisma({ memberships: [{ workspaceId: 'w1' }, { workspaceId: 'w2' }] }),
      config(false),
    );
    expect(await svc.scopeWhere(user())).toEqual({ workspaceId: { in: ['w1', 'w2'] } });
    expect(await svc.scopeWhere(user(), 'id')).toEqual({ id: { in: ['w1', 'w2'] } });
  });

  it('assertMember throws for non-members', async () => {
    const svc = new WorkspaceAccessService(makePrisma({ membership: null }), config(false));
    await expect(svc.assertMember(user(), 'w1')).rejects.toThrow();
  });

  it('RBAC off → assertPermission requires only membership for ordinary writes', async () => {
    const svc = new WorkspaceAccessService(makePrisma({ membership: { role: 'MEMBER' } }), config(false));
    await expect(svc.assertPermission(user(), 'w1', Permission.TaskWrite)).resolves.toBeUndefined();
  });

  it('RBAC off → destructive operations still require the real permission', async () => {
    const asMember = new WorkspaceAccessService(makePrisma({ membership: { role: 'MEMBER' } }), config(false));
    await expect(asMember.assertPermission(user(), 'w1', Permission.WorkspaceDelete)).rejects.toThrow();

    const asManager = new WorkspaceAccessService(makePrisma({ membership: { role: 'MANAGER' } }), config(false));
    await expect(asManager.assertPermission(user(), 'w1', Permission.WorkspaceDelete)).resolves.toBeUndefined();
  });

  it('RBAC off → privilege-granting operations still require the real permission', async () => {
    const asMember = new WorkspaceAccessService(makePrisma({ membership: { role: 'MEMBER' } }), config(false));
    await expect(asMember.assertPermission(user(), 'w1', Permission.MemberUpdate)).rejects.toThrow();
    await expect(asMember.assertPermission(user(), 'w1', Permission.MemberInvite)).rejects.toThrow();
    await expect(asMember.assertPermission(user(), 'w1', Permission.InviteManage)).rejects.toThrow();
    await expect(asMember.assertPermission(user(), 'w1', Permission.JoinManage)).rejects.toThrow();

    const asManager = new WorkspaceAccessService(makePrisma({ membership: { role: 'MANAGER' } }), config(false));
    await expect(asManager.assertPermission(user(), 'w1', Permission.MemberUpdate)).resolves.toBeUndefined();
  });

  it('assertValidRole accepts built-ins and workspace-local roles, rejects the rest', async () => {
    const noCustom = new WorkspaceAccessService(makePrisma({ role: null }), config(true));
    await expect(noCustom.assertValidRole('w1', 'MANAGER')).resolves.toBeUndefined();
    await expect(noCustom.assertValidRole('w1', 'Manager (Admin)')).rejects.toThrow(
      'Unknown role "Manager (Admin)" for this workspace.',
    );

    const withCustom = new WorkspaceAccessService(makePrisma({ role: { permissions: [] } }), config(true));
    await expect(withCustom.assertValidRole('w1', 'Auditor')).resolves.toBeUndefined();
  });

  it('assertValidRole rejects Object.prototype keys, which used to pass as built-ins', async () => {
    // `ROLE_PERMISSIONS['constructor']` is truthy on a plain object literal, so
    // the membership was written and every later permissionsForRole call threw.
    const svc = new WorkspaceAccessService(makePrisma({ role: null }), config(true));
    for (const key of ['constructor', 'toString', '__proto__']) {
      await expect(svc.assertValidRole('w1', key)).rejects.toThrow(
        `Unknown role "${key}" for this workspace.`,
      );
    }
  });

  it('RBAC on → MEMBER cannot delete, MANAGER can', async () => {
    const asMember = new WorkspaceAccessService(makePrisma({ membership: { role: 'MEMBER' } }), config(true));
    await expect(asMember.assertPermission(user(), 'w1', Permission.WorkspaceDelete)).rejects.toThrow();

    const asManager = new WorkspaceAccessService(makePrisma({ membership: { role: 'MANAGER' } }), config(true));
    await expect(asManager.assertPermission(user(), 'w1', Permission.WorkspaceDelete)).resolves.toBeUndefined();
  });

  it('membersHolding lists the active members whose role carries the permission', async () => {
    const prisma = {
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'boss', role: 'MANAGER' },
          { userId: 'deputy', role: 'ASSISTANT_MANAGER' },
          { userId: 'dev', role: 'SOFTWARE_DEVELOPER' },
          { userId: 'gate', role: 'Gatekeeper' },
        ]),
      },
      // The one custom role in play, holding exactly join:manage.
      workspaceRole: { findFirst: jest.fn().mockResolvedValue({ permissions: ['join:manage'] }) },
    } as unknown as PrismaService;
    const svc = new WorkspaceAccessService(prisma, config(true));
    await expect(svc.membersHolding('w1', Permission.JoinManage)).resolves.toEqual([
      'boss',
      'deputy',
      'gate',
    ]);
    expect(
      (prisma as unknown as { workspaceMember: { findMany: jest.Mock } }).workspaceMember.findMany,
    ).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'w1', status: 'ACTIVE' } }));
  });

  describe('rank — nobody hands out more than they hold', () => {
    const as = (role: string, custom?: string[]) =>
      new WorkspaceAccessService(
        makePrisma({ membership: { role }, role: custom ? { permissions: custom } : null }),
        config(true),
      );

    it('an assistant manager cannot grant MANAGER, the one role above their own', async () => {
      const svc = as('ASSISTANT_MANAGER');
      await expect(svc.assertCanGrantRole(user(), 'w1', 'MANAGER')).rejects.toThrow(
        'You cannot give someone the "MANAGER" role: it can do more than your own.',
      );
      for (const role of ['ASSISTANT_MANAGER', 'SOFTWARE_DEVELOPER', 'MEMBER']) {
        await expect(svc.assertCanGrantRole(user(), 'w1', role)).resolves.toBeUndefined();
      }
    });

    it('a manager can grant any built-in role', async () => {
      const svc = as('MANAGER');
      await expect(svc.assertCanGrantRole(user(), 'w1', 'MANAGER')).resolves.toBeUndefined();
    });

    it('a custom role holding only member:invite can add members, not mint a manager', async () => {
      const svc = as('Recruiter', [Permission.MemberInvite]);
      // The baseline is what every membership has, so granting it raises nobody.
      await expect(svc.assertCanGrantRole(user(), 'w1', 'MEMBER')).resolves.toBeUndefined();
      await expect(svc.assertCanGrantRole(user(), 'w1', 'MANAGER')).rejects.toThrow();
      await expect(svc.assertCanGrantRole(user(), 'w1', 'SOFTWARE_DEVELOPER')).rejects.toThrow();
    });

    it('an assistant manager cannot change or remove a manager', async () => {
      const svc = as('ASSISTANT_MANAGER');
      await expect(svc.assertNotOutranked(user(), 'w1', 'MANAGER')).rejects.toThrow(
        'You cannot change or remove a member whose role can do more than your own.',
      );
      await expect(svc.assertNotOutranked(user(), 'w1', 'ASSISTANT_MANAGER')).resolves.toBeUndefined();
    });

    it('a platform admin is not ranked', async () => {
      const svc = as('MEMBER');
      const admin = user({ isSuperuser: true });
      await expect(svc.assertCanGrantRole(admin, 'w1', 'MANAGER')).resolves.toBeUndefined();
      await expect(svc.assertNotOutranked(admin, 'w1', 'MANAGER')).resolves.toBeUndefined();
    });
  });

  it('admin bypasses permission checks even with RBAC on', async () => {
    const svc = new WorkspaceAccessService(makePrisma({}), config(true));
    await expect(
      svc.assertPermission(user({ isSuperuser: true }), 'w1', Permission.WorkspaceDelete),
    ).resolves.toBeUndefined();
  });
});

/**
 * The one invariant every power-reducing write runs — membership changes,
 * role-definition edits, account deactivation: a workspace never loses its
 * last ACTIVE holder of a capability it has now.
 */
describe('WorkspaceAccessService.capabilitiesOrphanedBy', () => {
  function orphanCheck(
    members: Array<{ id: string; role: string }>,
    custom: Array<{ name: string; permissions: unknown }> = [],
  ) {
    const findMany = jest.fn().mockResolvedValue(members);
    const prisma = {
      workspaceMember: { findMany },
      workspaceRole: { findMany: jest.fn().mockResolvedValue(custom) },
    } as unknown as PrismaService;
    return { svc: new WorkspaceAccessService(prisma, config(true)), findMany };
  }

  it('reads only ACTIVE memberships: a switched-off one authorizes nothing', async () => {
    const { svc, findMany } = orphanCheck([{ id: 'm1', role: 'MANAGER' }]);
    await svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: null });
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', status: 'ACTIVE' },
      select: { id: true, role: true },
    });
  });

  it('names what the last manager leaving would take with them', async () => {
    const { svc } = orphanCheck([
      { id: 'm1', role: 'MANAGER' },
      { id: 'm2', role: 'TESTER' },
    ]);
    await expect(svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: null })).resolves.toEqual(
      [Permission.MemberUpdate, Permission.WorkspaceDelete],
    );
    // An assistant manager keeps member:update, but nobody could delete the workspace.
    await expect(
      svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: 'ASSISTANT_MANAGER' }),
    ).resolves.toEqual([Permission.WorkspaceDelete]);
  });

  it('counts a custom role by what it holds, not by its name', async () => {
    const { svc } = orphanCheck(
      [
        { id: 'm1', role: 'MANAGER' },
        { id: 'm2', role: 'Steward' },
      ],
      [{ name: 'Steward', permissions: [Permission.MemberUpdate, Permission.WorkspaceDelete] }],
    );
    await expect(svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: null })).resolves.toEqual([]);
  });

  it('sees a role being cut down, as the new list would leave it', async () => {
    const { svc } = orphanCheck(
      [
        { id: 'm1', role: 'Boss' },
        { id: 'm2', role: 'MEMBER' },
      ],
      [{ name: 'Boss', permissions: Object.values(Permission) }],
    );
    await expect(
      svc.capabilitiesOrphanedBy('w1', { roleName: 'Boss', permissions: [Permission.WorkspaceRead] }),
    ).resolves.toEqual([Permission.MemberUpdate, Permission.WorkspaceDelete]);
    // Keeping member:update keeps that half.
    await expect(
      svc.capabilitiesOrphanedBy('w1', { roleName: 'Boss', permissions: [Permission.MemberUpdate] }),
    ).resolves.toEqual([Permission.WorkspaceDelete]);
  });

  it('cannot redefine a built-in role by naming it', async () => {
    const { svc } = orphanCheck([{ id: 'm1', role: 'MANAGER' }]);
    await expect(
      svc.capabilitiesOrphanedBy('w1', { roleName: 'MANAGER', permissions: [] }),
    ).resolves.toEqual([]);
  });

  // A legacy workspace with no administrator at all must stay repairable: what
  // it does not have, no change can take from it.
  it('loses nothing in a workspace that had no administrator to begin with', async () => {
    const { svc } = orphanCheck([
      { id: 'm1', role: 'MEMBER' },
      { id: 'm2', role: 'TESTER' },
    ]);
    await expect(svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: null })).resolves.toEqual([]);
  });

  it('asks inside the caller’s transaction when given one', async () => {
    const { svc, findMany } = orphanCheck([]);
    const tx = {
      workspaceMember: { findMany: jest.fn().mockResolvedValue([{ id: 'm1', role: 'MANAGER' }]) },
      workspaceRole: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(
      svc.capabilitiesOrphanedBy('w1', { membershipId: 'm1', role: null }, tx as never),
    ).resolves.toHaveLength(2);
    expect(findMany).not.toHaveBeenCalled();
  });
});
