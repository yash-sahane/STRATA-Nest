import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import { DENY_MESSAGE, type WorkspaceAccessService } from '../authz/workspace-access.service';
import {
  EmailInvitationsService,
  InviteCodesService,
  JoinRequestsService,
  PendingAccessService,
  WorkspaceRolesService,
} from './collections.services';
import type { CreateEmailInvitationDto, CreateInviteCodeDto } from './dto';

const user = { id: 'u1' } as User;

function build(held: string[]) {
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(0) };
  const create = jest.fn().mockImplementation(({ data }) => ({ ...stamps, ...data }));
  const update = jest.fn().mockImplementation(({ data }) => ({ ...stamps, ...data }));
  const prisma = {
    workspaceRole: { create, update, findFirst: jest.fn().mockResolvedValue({ id: 'r1', workspaceId: 'w1' }) },
    inviteCode: { create, update, findFirst: jest.fn().mockResolvedValue({ id: 'c1', workspaceId: 'w1' }) },
    emailInvitation: { create, update, findFirst: jest.fn().mockResolvedValue({ id: 'i1', workspaceId: 'w1' }) },
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    permissions: jest.fn().mockResolvedValue(new Set(held)),
  } as unknown as WorkspaceAccessService;
  return { prisma, access, create };
}

describe('WorkspaceRolesService — custom roles cannot escalate', () => {
  const assistantManager = [Permission.RoleManage, Permission.MemberUpdate, Permission.WorkspaceRead];

  it('refuses to grant a permission the caller does not hold', async () => {
    const { prisma, access, create } = build(assistantManager);
    const svc = new WorkspaceRolesService(prisma, access);
    await expect(
      svc.create(user, { workspaceId: 'w1', name: 'Super', permissions: [Permission.WorkspaceDelete] }),
    ).rejects.toThrow('You cannot grant permissions you do not hold: workspace:delete.');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses permission strings that are not real permission keys', async () => {
    const { prisma, access } = build(assistantManager);
    const svc = new WorkspaceRolesService(prisma, access);
    await expect(
      svc.create(user, { workspaceId: 'w1', name: 'Typo', permissions: ['workspace:destroy'] }),
    ).rejects.toThrow('Unknown permission(s): workspace:destroy.');
  });

  it('refuses to shadow a built-in role name (the row would be inert)', async () => {
    const { prisma, access } = build(assistantManager);
    const svc = new WorkspaceRolesService(prisma, access);
    await expect(svc.create(user, { workspaceId: 'w1', name: 'MANAGER' })).rejects.toThrow(
      '"MANAGER" is a built-in role and cannot be redefined.',
    );
  });

  it('allows a subset of the caller’s own permissions', async () => {
    const { prisma, access, create } = build(assistantManager);
    const svc = new WorkspaceRolesService(prisma, access);
    await expect(
      svc.create(user, { workspaceId: 'w1', name: 'Auditor', permissions: [Permission.WorkspaceRead] }),
    ).resolves.toBeDefined();
    expect(create).toHaveBeenCalled();
  });

  it('applies the same guard on patch, so a benign role cannot be escalated later', async () => {
    const { prisma, access } = build(assistantManager);
    const svc = new WorkspaceRolesService(prisma, access);
    await expect(svc.patch(user, 'r1', { permissions: [Permission.WorkspaceDelete] })).rejects.toThrow(
      'You cannot grant permissions you do not hold: workspace:delete.',
    );
  });
});

describe('Invitations — server-owned secrets and validated roles', () => {
  it('ignores a caller-supplied invite code and generates one', async () => {
    const { prisma, access, create } = build([Permission.InviteManage]);
    const svc = new InviteCodesService(prisma, access);
    // `code` is not on the DTO (the ValidationPipe strips it) — the cast models
    // an over-posting client whose payload reached the service anyway.
    await svc.create(user, { workspaceId: 'w1', code: 'GUESSME', role: 'MEMBER' } as CreateInviteCodeDto);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: expect.not.stringMatching(/^GUESSME$/) }) }),
    );
    expect(access.assertValidRole).toHaveBeenCalledWith('w1', 'MEMBER');
  });

  it('ignores a caller-supplied token/status on an e-mail invitation', async () => {
    const { prisma, access, create } = build([Permission.InviteManage]);
    const svc = new EmailInvitationsService(prisma, access);
    // Same over-posting model as above: neither `token` nor `status` is on the DTO.
    await svc.create(user, {
      workspaceId: 'w1',
      email: 'A@Example.com',
      token: 'short',
      status: 'ACCEPTED',
      expiresAt: new Date().toISOString(),
    } as CreateEmailInvitationDto);
    const data = create.mock.calls[0][0].data;
    expect(data.token).not.toBe('short');
    expect(data.status).toBe('PENDING');
    expect(data.email).toBe('a@example.com');
  });

  it('hides pending invitations from a member without invite:manage', async () => {
    const { prisma, access, findMany } = buildRequests({ holdsManage: false });
    const svc = new EmailInvitationsService(prisma, access);
    await svc.list(user, {});
    // The scope collapses to an empty id list, so the query can return nothing —
    // no `?workspaceId=` filter can widen it back.
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ workspaceId: { in: [] } });
  });

  it('shows them to a member who does hold invite:manage', async () => {
    const { prisma, access, findMany } = buildRequests({ holdsManage: true });
    const svc = new InviteCodesService(prisma, access);
    await svc.list(user, {});
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ workspaceId: { in: ['w1'] } });
  });
});

/**
 * Builder for the self-service request collections (and the invitation reads):
 * `user` is NOT a member of w1 unless `isMember` says so. `holdsManage` is the
 * collection's own read/override permission — `invite:manage` for the
 * invitations, `join:manage` for the request queues.
 */
function buildRequests(
  opts: {
    isMember?: boolean;
    holdsManage?: boolean;
    workspaceExists?: boolean;
    row?: { id: string; workspaceId: string; userId: string };
  } = {},
) {
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0) };
  const upsert = jest.fn().mockImplementation(({ create, update }) => ({
    ...stamps,
    ...create,
    ...update,
  }));
  const remove = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const update = jest.fn().mockImplementation(({ data }) => ({ ...stamps, ...data }));
  const findFirst = jest
    .fn()
    .mockResolvedValue(opts.row ?? { id: 'j1', workspaceId: 'w1', userId: 'u1' });
  const model = { upsert, update, delete: remove, findMany, count, findFirst };
  const prisma = {
    workspace: {
      findUnique: jest.fn().mockResolvedValue(opts.workspaceExists === false ? null : { id: 'w1' }),
    },
    joinRequest: model,
    pendingWorkspaceAccess: model,
    emailInvitation: model,
    inviteCode: model,
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
    activeMembership: jest.fn().mockResolvedValue(opts.isMember ? { id: 'm1' } : null),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    assertPermission: jest.fn().mockRejectedValue(new ForbiddenException(DENY_MESSAGE)),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(opts.holdsManage ?? false),
  } as unknown as WorkspaceAccessService;
  return { prisma, access, upsert, remove, findMany, findFirst, update };
}

describe('Join requests / pending access — the author is not a member', () => {
  it('refuses a request for a workspace that does not exist', async () => {
    const { prisma, access, upsert } = buildRequests({ workspaceExists: false });
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.create(user, { workspaceId: 'nope' })).rejects.toThrow('Workspace not found.');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a request from someone who is already a member', async () => {
    const { prisma, access, upsert } = buildRequests({ isMember: true });
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.create(user, { workspaceId: 'w1' })).rejects.toThrow(
      'You are already a member of this workspace.',
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts so a re-application after a rejection reopens the same row', async () => {
    const { prisma, access, upsert } = buildRequests();
    const svc = new JoinRequestsService(prisma, access);
    await svc.create(user, { workspaceId: 'w1', message: 'please' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
        update: { message: 'please', status: 'PENDING', handledById: null },
      }),
    );
  });

  it('lets the author see their own request even outside their workspaces', async () => {
    const { prisma, access, findMany } = buildRequests();
    const svc = new JoinRequestsService(prisma, access);
    await svc.list(user, {});
    // No join:manage anywhere, so the workspace half collapses to an empty id
    // list: a plain member cannot enumerate who has asked to join, but the
    // author's own row survives on the second arm.
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ workspaceId: { in: [] } }, { userId: 'u1' }],
    });
  });

  it('shows the whole queue to a member holding join:manage', async () => {
    const { prisma, access, findMany } = buildRequests({ holdsManage: true });
    const svc = new PendingAccessService(prisma, access);
    await svc.list(user, {});
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1' }],
    });
  });

  it('lets the author cancel their own request without join:manage', async () => {
    const { prisma, access, remove } = buildRequests();
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.remove(user, 'j1')).resolves.toBeUndefined();
    expect(access.assertPermission).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'j1' } });
  });

  it('still refuses to let a bystander cancel somebody else’s request', async () => {
    const { prisma, access, remove } = buildRequests({
      row: { id: 'j1', workspaceId: 'w1', userId: 'someone-else' },
    });
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.remove(user, 'j1')).rejects.toThrow(DENY_MESSAGE);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects a status the approval workflow cannot act on', async () => {
    const { prisma, access } = buildRequests();
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.patch(user, 'j1', { status: 'MAYBE' })).rejects.toThrow(
      'Unknown join request status "MAYBE".',
    );
  });

  it('rejects APPROVED, which this path cannot honour and would wedge the request', async () => {
    // PATCH never touches workspaceMember, so an "approved" request granted no
    // access — and JoinRequestApprovalService.approve then refused it forever
    // ("Join request already handled"). Approval goes through that service.
    const { prisma, access, update } = buildRequests();
    const svc = new JoinRequestsService(prisma, access);
    await expect(svc.patch(user, 'j1', { status: 'APPROVED' })).rejects.toThrow(
      'Unknown join request status "APPROVED".',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('validates the requested role on pending access and upserts on (workspace,user)', async () => {
    const { prisma, access, upsert } = buildRequests();
    const svc = new PendingAccessService(prisma, access);
    await svc.create(user, { workspaceId: 'w1', requestedRole: 'TESTER' });
    expect(access.assertValidRole).toHaveBeenCalledWith('w1', 'TESTER');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
        update: { requestedRole: 'TESTER' },
      }),
    );
  });
});

/**
 * A rename re-points memberships: they store the role NAME, so moving a name
 * onto a different permission set grants that set to everyone holding it.
 * `assertGrantable` guarded the permissions edit but not the rename, which is
 * the same grant reached from the other side.
 */
describe('WorkspaceRolesService.patch — renames are grants too', () => {
  const leadPermissions = [Permission.RoleManage, Permission.WorkspaceRead];

  function buildRoles(held: string[], existing: Record<string, unknown>, membersOnOldName = 0) {
    const update = jest.fn().mockImplementation(({ data }) => ({
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...existing,
      ...data,
    }));
    // A rename carries every row that stores the role by NAME, so the cascade
    // runs in the same transaction as the rename itself.
    const carry = {
      workspaceMember: jest.fn().mockResolvedValue({ count: membersOnOldName }),
      inviteCode: jest.fn().mockResolvedValue({ count: 0 }),
      emailInvitation: jest.fn().mockResolvedValue({ count: 0 }),
      pendingWorkspaceAccess: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      workspaceRole: { update, findFirst: jest.fn().mockResolvedValue(existing) },
      workspaceMember: { count: jest.fn().mockResolvedValue(membersOnOldName), updateMany: carry.workspaceMember },
      inviteCode: { updateMany: carry.inviteCode },
      emailInvitation: { updateMany: carry.emailInvitation },
      pendingWorkspaceAccess: { updateMany: carry.pendingWorkspaceAccess },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      permissions: jest.fn().mockResolvedValue(new Set(held)),
    } as unknown as WorkspaceAccessService;
    return { svc: new WorkspaceRolesService(prisma, access), update, carry, access };
  }

  const owner = {
    id: 'r-owner',
    workspaceId: 'w1',
    name: 'Owner',
    permissions: [Permission.WorkspaceDelete, Permission.RoleManage],
  };

  it('refuses to rename a role whose permissions the caller does not hold', async () => {
    // The escalation: delete your own `Lead` row to free the name, then rename
    // the `Owner` row to `Lead` — your membership now resolves to Owner's set.
    const { svc, update } = buildRoles(leadPermissions, owner);
    await expect(svc.patch(user, 'r-owner', { name: 'Lead' })).rejects.toThrow(
      'You cannot grant permissions you do not hold: workspace:delete.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  // Replaces the old "refuse while the name is in use" rule. Refusing only ever
  // looked at MEMBERSHIPS, so an invite code / e-mail invitation /
  // pending-access row naming the role sailed through and was left pointing at a
  // name that no longer resolved — `assertValidRole` then 400s the acceptance
  // with `Unknown role "Auditor"` and the invite is permanently unusable.
  // Carrying every naming row is not a privilege change: each one still points
  // at the same WorkspaceRole with the same permissions.
  it('carries members AND invite/e-mail/pending rows onto the new name, in one transaction', async () => {
    const inUse = { id: 'r-1', workspaceId: 'w1', name: 'Auditor', permissions: leadPermissions };
    const { svc, update, carry } = buildRoles(leadPermissions, inUse, 3);
    await expect(svc.patch(user, 'r-1', { name: 'Reviewer' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { name: 'Reviewer' } });
    const scope = { workspaceId: 'w1', role: 'Auditor' };
    expect(carry.workspaceMember).toHaveBeenCalledWith({ where: scope, data: { role: 'Reviewer' } });
    expect(carry.inviteCode).toHaveBeenCalledWith({ where: scope, data: { role: 'Reviewer' } });
    expect(carry.emailInvitation).toHaveBeenCalledWith({ where: scope, data: { role: 'Reviewer' } });
    expect(carry.pendingWorkspaceAccess).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', requestedRole: 'Auditor' },
      data: { requestedRole: 'Reviewer' },
    });
  });

  it('allows an unused rename within the caller’s own permissions', async () => {
    const unused = { id: 'r-1', workspaceId: 'w1', name: 'Auditor', permissions: leadPermissions };
    const { svc, update } = buildRoles(leadPermissions, unused, 0);
    await expect(svc.patch(user, 'r-1', { name: 'Reviewer' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { name: 'Reviewer' } });
  });

  it('renames a role holding a legacy UNRECOGNISED permission string', async () => {
    // `tasks:write` is not a real key (the real one is `task:write`) but rows
    // written before the DTO was validated can hold it. Re-validating the STORED
    // list on rename made such a row permanently unrenameable, with a 400 naming
    // a permission the caller never sent.
    const legacy = {
      id: 'r-1',
      workspaceId: 'w1',
      name: 'Leed',
      permissions: [Permission.WorkspaceRead, 'tasks:write'],
    };
    const { svc, update } = buildRoles([Permission.WorkspaceRead, Permission.RoleManage], legacy);
    await expect(svc.patch(user, 'r-1', { name: 'Lead' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { name: 'Lead' } });
  });

  it('still rejects an unrecognised permission the CALLER supplies', async () => {
    const row = { id: 'r-1', workspaceId: 'w1', name: 'Auditor', permissions: leadPermissions };
    const { svc, update } = buildRoles(leadPermissions, row);
    await expect(svc.patch(user, 'r-1', { permissions: ['tasks:write'] })).rejects.toThrow(
      'Unknown permission(s): tasks:write.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('asserts role:manage BEFORE any detail-bearing probe', async () => {
    // Otherwise PATCH {name} is an oracle: the escalation error lists every
    // permission of the role the caller does not hold, enumerating the whole
    // custom-RBAC configuration for a read-only member one role id at a time.
    const { svc, access } = buildRoles([], owner);
    (access.assertPermission as jest.Mock).mockRejectedValue(new Error('DENY'));
    await expect(svc.patch(user, 'r-owner', { name: 'Lead' })).rejects.toThrow('DENY');
    expect(access.assertPermission).toHaveBeenCalledWith(user, 'w1', Permission.RoleManage);
  });
});
