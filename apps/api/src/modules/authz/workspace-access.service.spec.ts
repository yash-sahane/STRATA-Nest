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

  it('admin bypasses permission checks even with RBAC on', async () => {
    const svc = new WorkspaceAccessService(makePrisma({}), config(true));
    await expect(
      svc.assertPermission(user({ isSuperuser: true }), 'w1', Permission.WorkspaceDelete),
    ).resolves.toBeUndefined();
  });
});
