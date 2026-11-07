import { ForbiddenException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { capabilitiesOrphaned, type AdministrationChange } from '../authz/administration';
import { Permission } from '../authz/permissions';
import { DENY_MESSAGE, type WorkspaceAccessService } from '../authz/workspace-access.service';
import {
  InviteCodesService,
  JoinRequestsService,
  WorkspaceRolesService,
} from './collections.services';
import type { CreateInviteCodeDto } from './dto';

const user = { id: 'u1' } as User;

function build(held: string[]) {
  const stamps = { createdAt: new Date(0), updatedAt: new Date(0), expiresAt: new Date(0) };
  const create = jest.fn().mockImplementation(({ data }) => ({ ...stamps, ...data }));
  const update = jest.fn().mockImplementation(({ data }) => ({ ...stamps, ...data }));
  const prisma = {
    workspaceRole: { create, update, findFirst: jest.fn().mockResolvedValue({ id: 'r1', workspaceId: 'w1' }) },
    inviteCode: { create, update, findFirst: jest.fn().mockResolvedValue({ id: 'c1', workspaceId: 'w1' }) },
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    assertCanGrantRole: jest.fn().mockResolvedValue(undefined),
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

describe('WorkspaceRolesService.remove — a role in use stays', () => {
  function buildRemove(counts: { members?: number; codes?: number }) {
    const remove = jest.fn().mockResolvedValue({});
    const prisma = {
      workspaceRole: {
        findFirst: jest.fn().mockResolvedValue({ id: 'r1', workspaceId: 'w1', name: 'Lead' }),
        delete: remove,
      },
      workspaceMember: { count: jest.fn().mockResolvedValue(counts.members ?? 0) },
      inviteCode: { count: jest.fn().mockResolvedValue(counts.codes ?? 0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
    } as unknown as WorkspaceAccessService;
    return { svc: new WorkspaceRolesService(prisma, access), prisma, access, remove };
  }

  it('refuses while members hold it — deleting would drop them to read-only unannounced', async () => {
    const { svc, prisma, remove } = buildRemove({ members: 3 });
    await expect(svc.remove(user, 'r1')).rejects.toThrow(
      '3 members hold the "Lead" role. Give them another role first.',
    );
    expect(prisma.workspaceMember.count).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', role: 'Lead' },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses while an invite code still hands it out', async () => {
    const { svc, remove } = buildRemove({ codes: 1 });
    await expect(svc.remove(user, 'r1')).rejects.toThrow(
      'An invite code still hands out the "Lead" role. Delete that code first.',
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('checks role:manage before saying anything about who holds the role', async () => {
    const { svc, prisma, access } = buildRemove({ members: 3 });
    (access.assertPermission as jest.Mock).mockRejectedValue(new Error('denied'));
    await expect(svc.remove(user, 'r1')).rejects.toThrow('denied');
    expect(prisma.workspaceMember.count).not.toHaveBeenCalled();
  });

  it('deletes a role nobody holds', async () => {
    const { svc, remove } = buildRemove({});
    await svc.remove(user, 'r1');
    expect(remove).toHaveBeenCalledWith({ where: { id: 'r1' } });
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

  it('refuses a code at a role the caller could not grant directly', async () => {
    const { prisma, access, create } = build([Permission.InviteManage]);
    (access.assertCanGrantRole as jest.Mock).mockRejectedValue(new Error('rank'));
    await expect(
      new InviteCodesService(prisma, access).create(user, { workspaceId: 'w1', role: 'MANAGER' }),
    ).rejects.toThrow('rank');
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(user, 'w1', 'MANAGER');
    expect(create).not.toHaveBeenCalled();
  });

  it('hides invite codes from a member without invite:manage', async () => {
    const { prisma, access, findMany } = buildRequests({ holdsManage: false });
    const svc = new InviteCodesService(prisma, access);
    await svc.list(user, {});
    // Nothing but the never-matching arm is left, so the query can return
    // nothing — no `?workspaceId=` filter can widen it back.
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({ OR: [{ workspaceId: { in: [] } }] });
  });

  // Reading a code is holding it. An Assistant Manager used to be shown the
  // Manager-level codes too, and could redeem one after leaving the workspace.
  it('shows a holder of invite:manage only the codes for roles they could grant', async () => {
    const { prisma, access, findMany } = buildRequests({ holdsManage: true });
    (access.grantableRoles as jest.Mock).mockResolvedValue(['MEMBER', 'TESTER']);
    const svc = new InviteCodesService(prisma, access);
    await svc.list(user, {});
    expect(access.grantableRoles).toHaveBeenCalledWith(user, 'w1');
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ workspaceId: { in: [] } }, { workspaceId: 'w1', role: { in: ['MEMBER', 'TESTER'] } }],
    });
  });

  it('treats reviving a spent code as offering its role again', async () => {
    const { prisma, access } = build([Permission.InviteManage]);
    (prisma.inviteCode.findFirst as jest.Mock).mockResolvedValue({
      id: 'c1',
      workspaceId: 'w1',
      role: 'MANAGER',
    });
    (access.assertCanGrantRole as jest.Mock).mockRejectedValue(new Error('rank'));
    // The row has to be READABLE first; that is a separate question from
    // whether its role may be offered again.
    Object.assign(access, {
      accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
      can: jest.fn().mockResolvedValue(true),
      grantableRoles: jest.fn().mockResolvedValue(['MANAGER']),
    });
    const svc = new InviteCodesService(prisma, access);
    await expect(svc.patch(user, 'c1', { maxUses: 50 })).rejects.toThrow('rank');
    expect(access.assertCanGrantRole).toHaveBeenCalledWith(user, 'w1', 'MANAGER');
  });
});

/** For the cases that are not about the event a new request emits. */
const noEvents = { emit: jest.fn() } as unknown as EventEmitter2;

/**
 * Builder for the join-request collection (and the invite-code reads): `user`
 * is NOT a member of w1 unless `isMember` says so. `holdsManage` is the
 * collection's own read/override permission — `invite:manage` for the codes,
 * `join:manage` for the request queue.
 */
function buildRequests(
  opts: {
    isMember?: boolean;
    holdsManage?: boolean;
    workspaceExists?: boolean;
    row?: { id: string; workspaceId: string; userId: string };
    /** The caller's request as it stands before this call; null = none yet. */
    standing?: { status: string } | null;
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
  const findUnique = jest.fn().mockResolvedValue(opts.standing ?? null);
  const model = { upsert, update, delete: remove, findMany, count, findFirst, findUnique };
  const prisma = {
    workspace: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.workspaceExists === false ? null : { id: 'w1', name: 'Acme' }),
    },
    joinRequest: model,
    inviteCode: model,
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
    activeMembership: jest.fn().mockResolvedValue(opts.isMember ? { id: 'm1' } : null),
    assertValidRole: jest.fn().mockResolvedValue(undefined),
    grantableRoles: jest.fn().mockResolvedValue(['MEMBER']),
    assertPermission: jest.fn().mockRejectedValue(new ForbiddenException(DENY_MESSAGE)),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(opts.holdsManage ?? false),
  } as unknown as WorkspaceAccessService;
  const emit = jest.fn();
  const events = { emit } as unknown as EventEmitter2;
  return { prisma, access, events, emit, upsert, remove, findMany, findFirst, update };
}

describe('Join requests — the managers are told', () => {
  const asker = { id: 'u1', name: 'Asha Rao', email: 'asha@x.com' } as User;

  it('announces a new request to the workspace', async () => {
    const { prisma, access, events, emit } = buildRequests();
    await new JoinRequestsService(prisma, access, events).create(asker, { workspaceId: 'w1' });
    expect(emit).toHaveBeenCalledWith(
      'workspace.join_request.created',
      expect.objectContaining({
        workspaceId: 'w1',
        payload: expect.objectContaining({
          workspaceId: 'w1',
          userId: 'u1',
          requesterName: 'Asha Rao',
          workspaceName: 'Acme',
        }),
      }),
    );
  });

  it('and a request re-opened after being declined', async () => {
    const { prisma, access, events, emit } = buildRequests({ standing: { status: 'REJECTED' } });
    await new JoinRequestsService(prisma, access, events).create(asker, { workspaceId: 'w1' });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('but not an edit to one that is already waiting', async () => {
    const { prisma, access, events, emit } = buildRequests({ standing: { status: 'PENDING' } });
    await new JoinRequestsService(prisma, access, events).create(asker, {
      workspaceId: 'w1',
      message: 'second thoughts',
    });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('Join requests — the author is not a member', () => {
  it('refuses a request for a workspace that does not exist', async () => {
    const { prisma, access, events, upsert } = buildRequests({ workspaceExists: false });
    const svc = new JoinRequestsService(prisma, access, events);
    await expect(svc.create(user, { workspaceId: 'nope' })).rejects.toThrow('Workspace not found.');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a request from someone who is already a member', async () => {
    const { prisma, access, upsert } = buildRequests({ isMember: true });
    const svc = new JoinRequestsService(prisma, access, noEvents);
    await expect(svc.create(user, { workspaceId: 'w1' })).rejects.toThrow(
      'You are already a member of this workspace.',
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts so a re-application after a rejection reopens the same row', async () => {
    const { prisma, access, upsert } = buildRequests();
    const svc = new JoinRequestsService(prisma, access, noEvents);
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
    const svc = new JoinRequestsService(prisma, access, noEvents);
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
    const svc = new JoinRequestsService(prisma, access, noEvents);
    await svc.list(user, {});
    expect(findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ workspaceId: { in: ['w1'] } }, { userId: 'u1' }],
    });
  });

  it('lets the author cancel their own request without join:manage', async () => {
    const { prisma, access, remove } = buildRequests();
    const svc = new JoinRequestsService(prisma, access, noEvents);
    await expect(svc.remove(user, 'j1')).resolves.toBeUndefined();
    expect(access.assertPermission).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'j1' } });
  });

  it('still refuses to let a bystander cancel somebody else’s request', async () => {
    const { prisma, access, remove } = buildRequests({
      row: { id: 'j1', workspaceId: 'w1', userId: 'someone-else' },
    });
    const svc = new JoinRequestsService(prisma, access, noEvents);
    await expect(svc.remove(user, 'j1')).rejects.toThrow(DENY_MESSAGE);
    expect(remove).not.toHaveBeenCalled();
  });

  // A PATCH wrote status and handledBy straight onto the row: an "approved"
  // request that granted nothing (and wedged the real approve forever), a
  // "rejected" one nobody was told about, a reopened decision, and any name at
  // all as the person who handled it. Deciding is approve/reject's; a plain
  // rejection is routed there by the controller.
  it('sets no status — approving, rejecting or reopening — and no handler', async () => {
    for (const body of [
      { status: 'APPROVED' },
      { status: 'PENDING' },
      { status: 'MAYBE' },
      { status: 'REJECTED', handledBy: 'somebody' },
      { handledBy: 'somebody' },
    ]) {
      const { prisma, access, update } = buildRequests();
      const svc = new JoinRequestsService(prisma, access, noEvents);
      await expect(svc.patch(user, 'j1', body)).rejects.toThrow(/approve or \/reject|cannot be set/);
      expect(update).not.toHaveBeenCalled();
    }
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
    };
    // The holders, as re-read under the new name once the rename has landed.
    const moved = Array.from({ length: membersOnOldName }, (_, i) => ({ id: `m-${i}`, workspaceId: 'w1' }));
    const announceWrite = jest.fn();
    const prisma = {
      workspaceRole: { update, findFirst: jest.fn().mockResolvedValue(existing) },
      workspaceMember: {
        count: jest.fn().mockResolvedValue(membersOnOldName),
        updateMany: carry.workspaceMember,
        findMany: jest.fn().mockResolvedValue(moved),
      },
      inviteCode: { updateMany: carry.inviteCode },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      announceWrite,
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      permissions: jest.fn().mockResolvedValue(new Set(held)),
    } as unknown as WorkspaceAccessService;
    return { svc: new WorkspaceRolesService(prisma, access), update, carry, access, announceWrite };
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
  // looked at MEMBERSHIPS, so an invite code naming the role sailed through and
  // was left pointing at a name that no longer resolved — `assertValidRole`
  // then 400s the redemption with `Unknown role "Auditor"` and the code is
  // permanently unusable. Carrying every naming row is not a privilege change:
  // each one still points at the same WorkspaceRole with the same permissions.
  it('carries members AND invite codes onto the new name, in one transaction', async () => {
    const inUse = { id: 'r-1', workspaceId: 'w1', name: 'Auditor', permissions: leadPermissions };
    const { svc, update, carry, announceWrite } = buildRoles(leadPermissions, inUse, 3);
    await expect(svc.patch(user, 'r-1', { name: 'Reviewer' })).resolves.toBeDefined();
    // One frame per moved membership: updateMany is invisible to the write hook,
    // and the holders' screens resolve their permissions by the role's name.
    expect(announceWrite).toHaveBeenCalledTimes(3);
    expect(announceWrite).toHaveBeenCalledWith('WorkspaceMember', 'update', expect.objectContaining({ id: 'm-0' }));
    expect(update).toHaveBeenCalledWith({ where: { id: 'r-1' }, data: { name: 'Reviewer' } });
    const scope = { workspaceId: 'w1', role: 'Auditor' };
    expect(carry.workspaceMember).toHaveBeenCalledWith({ where: scope, data: { role: 'Reviewer' } });
    expect(carry.inviteCode).toHaveBeenCalledWith({ where: scope, data: { role: 'Reviewer' } });
  });

  // The permission list being SAVED was checked; the one being replaced was
  // not, so `role:manage` could empty a role that outranks its holder.
  it('refuses to cut down a role that carries more than the caller holds', async () => {
    const { svc, update } = buildRoles(leadPermissions, owner);
    await expect(svc.patch(user, 'r-owner', { permissions: [] })).rejects.toThrow(
      'You cannot grant permissions you do not hold: workspace:delete.',
    );
    expect(update).not.toHaveBeenCalled();
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

/**
 * The second half of the owner takeover: once the owner sat on a custom role,
 * cutting that role down on this screen demoted them without touching their
 * membership — and a role edit could leave the workspace with nobody active
 * able to administer it, which no membership guard ever saw.
 */
describe('WorkspaceRolesService.patch — power taken from a role is taken from its holders', () => {
  const ALL = Object.values(Permission) as string[];
  const boss = { id: 'r-boss', workspaceId: 'w1', name: 'Boss', permissions: ALL };

  function buildCut(opts: {
    platformAdmin?: boolean;
    /** Whether the workspace owner's membership is on the role being edited. */
    ownerHolds?: boolean;
    /** The other ACTIVE members' roles, besides the owner on Boss. */
    others?: string[];
  }) {
    const update = jest.fn().mockImplementation(({ data }) => ({
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...boss,
      ...data,
    }));
    const prisma = {
      workspaceRole: { update, findFirst: jest.fn().mockResolvedValue(boss) },
      workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }) },
      workspaceMember: {
        findFirst: jest.fn().mockResolvedValue(opts.ownerHolds ? { id: 'm-owner' } : null),
      },
    } as unknown as PrismaService;
    const members = [
      { id: 'm-owner', role: opts.ownerHolds ? 'Boss' : 'MANAGER' },
      ...(opts.others ?? []).map((role, i) => ({ id: `m-${i}`, role })),
    ];
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
      // A MANAGER holds everything, so no escalation rule stands in the way.
      permissions: jest.fn().mockResolvedValue(new Set(['*'])),
      capabilitiesOrphanedBy: jest.fn(async (_ws: string, change: AdministrationChange) =>
        capabilitiesOrphaned({ members, definitions: new Map([['Boss', ALL]]) }, change),
      ),
    } as unknown as WorkspaceAccessService;
    return { svc: new WorkspaceRolesService(prisma, access), update, access };
  }

  const baseline = [Permission.WorkspaceRead, Permission.MemberRead];

  it('refuses a manager who is not the owner cutting down the role the owner holds', async () => {
    const { svc, update } = buildCut({ ownerHolds: true, others: ['MANAGER'] });
    await expect(svc.patch(user, 'r-boss', { permissions: baseline })).rejects.toThrow(
      'The workspace owner holds the "Boss" role, so only they or a platform administrator can take permissions away from it.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('lets the owner trim a role they hold, while somebody else still administers', async () => {
    const owner = { id: 'owner' } as User;
    const { svc, update } = buildCut({ ownerHolds: true, others: ['MANAGER'] });
    await expect(
      svc.patch(owner, 'r-boss', { permissions: ALL.filter((p) => p !== Permission.IntegrationWrite) }),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('lets a platform administrator repair it', async () => {
    const { svc, update } = buildCut({ ownerHolds: true, platformAdmin: true });
    await expect(svc.patch(user, 'r-boss', { permissions: baseline })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('never refuses ADDING to the owner’s role', async () => {
    const { svc, update } = buildCut({ ownerHolds: true });
    await expect(svc.patch(user, 'r-boss', { permissions: ALL })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('refuses an edit that leaves nobody active able to administer the workspace', async () => {
    // Not the owner rule this time (the owner is not on Boss): Boss is the only
    // role anybody active holds that can administer, so cutting it orphans the
    // workspace.
    const { svc, update, access } = buildCut({ others: ['Boss'] });
    (access.capabilitiesOrphanedBy as jest.Mock).mockImplementation(
      async (_ws: string, change: AdministrationChange) =>
        capabilitiesOrphaned(
          {
            members: [
              { id: 'm-owner', role: 'MEMBER' },
              { id: 'm-0', role: 'Boss' },
            ],
            definitions: new Map([['Boss', ALL]]),
          },
          change,
        ),
    );
    await expect(svc.patch(user, 'r-boss', { permissions: baseline })).rejects.toThrow(
      'That would leave nobody active in this workspace who can change members’ roles and access, or delete the workspace.',
    );
    expect(access.capabilitiesOrphanedBy).toHaveBeenCalledWith('w1', {
      roleName: 'Boss',
      permissions: baseline,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows the same cut while another role still administers', async () => {
    const { svc, update } = buildCut({ others: ['Boss'] });
    // The owner's MANAGER role still holds both capabilities.
    await expect(svc.patch(user, 'r-boss', { permissions: baseline })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });
});

/**
 * A switched-off member asking back in was shown as a stranger, with the role
 * picker on the read-only Member — so approving demoted them without a word.
 */
describe('Join requests — a former member is shown as one', () => {
  function buildQueue(membership: { role: string; status: string } | null) {
    const row = {
      id: 'j1',
      workspaceId: 'w1',
      userId: 'u9',
      message: '',
      status: 'PENDING',
      handledById: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const memberships = jest
      .fn()
      .mockResolvedValue(membership ? [{ workspaceId: 'w1', userId: 'u9', ...membership }] : []);
    const prisma = {
      joinRequest: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u9', name: 'Nia', email: 'nia@x.com', avatar: '' }]),
      },
      workspaceMember: { findMany: memberships },
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
      accessibleWorkspaceIds: jest.fn().mockResolvedValue(['w1']),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      can: jest.fn().mockResolvedValue(true),
    } as unknown as WorkspaceAccessService;
    return { svc: new JoinRequestsService(prisma, access, noEvents), memberships };
  }

  it('carries the role a switched-off member held', async () => {
    const { svc } = buildQueue({ role: 'MANAGER', status: 'INACTIVE' });
    const page = await svc.list(user, { workspaceId: 'w1' });
    expect(page.items[0]).toMatchObject({ previousRole: 'MANAGER', alreadyMember: false });
  });

  it('still reports an ACTIVE member as already in, with no previous role', async () => {
    const { svc } = buildQueue({ role: 'TESTER', status: 'ACTIVE' });
    const page = await svc.list(user, { workspaceId: 'w1' });
    expect(page.items[0]).toMatchObject({ previousRole: null, alreadyMember: true });
  });

  it('treats an invitation never accepted as no membership at all', async () => {
    const { svc } = buildQueue({ role: 'TESTER', status: 'INVITED' });
    const page = await svc.list(user, { workspaceId: 'w1' });
    expect(page.items[0]).toMatchObject({ previousRole: null, alreadyMember: false });
  });

  it('and a stranger as a stranger', async () => {
    const { svc } = buildQueue(null);
    const page = await svc.list(user, { workspaceId: 'w1' });
    expect(page.items[0]).toMatchObject({ previousRole: null, alreadyMember: false });
  });
});
