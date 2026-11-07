import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { PasswordService } from '../auth/services/password.service';
import type { MailService } from '../mail/mail.service';
import type { UserMapper } from './user.mapper';
import { UsersService } from './users.service';

const caller = { id: 'u1', email: 'a@x.com', name: 'A' } as User;

function build(
  over: {
    canInvite?: boolean;
    validRole?: boolean;
    existingUser?: User | null;
    /** The rank rule refuses: the role asked for can do more than the caller's. */
    outranked?: boolean;
    /** Whether mail can reach an inbox (RESEND_API_KEY set). */
    mailDelivers?: boolean;
    /** The membership a password re-issue looks up, and the account behind it. */
    membership?: { role: string } | null;
    target?: Partial<User> | null;
    /** The member being acted on can do more than the caller. */
    targetOutranks?: boolean;
    /** The target's memberships in OTHER workspaces, and whether the caller manages each. */
    elsewhere?: { workspaceId: string; role: string; callerManages: boolean }[];
    /** UserDeactivationService refuses (an owner, a last manager), with this message. */
    deactivationRefuses?: string;
  } = {},
) {
  const memberCreate = jest.fn().mockResolvedValue({ id: 'm1' });
  const userCreate = jest.fn().mockImplementation(({ data }) => data);
  const userUpdate = jest.fn().mockImplementation(({ data }) => data);
  const prisma = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'w1', name: 'W', ownerId: 'someone-else' }) },
    workspaceMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue(over.membership ? { status: 'ACTIVE', ...over.membership } : null),
      findMany: jest
        .fn()
        .mockImplementation((args: { where?: { workspaceId?: { not?: string } } }) =>
          Promise.resolve(
            args?.where?.workspaceId?.not !== undefined
              ? (over.elsewhere ?? []).map(({ workspaceId, role }) => ({ workspaceId, role }))
              : [{ workspaceId: 'w1' }],
          ),
        ),
      create: memberCreate,
    },
    user: {
      // `{ AND: [...] }` is the scoped id lookup (retrieve/update); a bare
      // `email` filter is invite()'s existing-account probe.
      findFirst: jest.fn().mockImplementation((args: { where?: { AND?: unknown } }) =>
        Array.isArray(args?.where?.AND) ? caller : (over.existingUser ?? null),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(over.target ?? null),
      count: jest.fn().mockResolvedValue(0),
      create: userCreate,
      update: userUpdate,
    },
    joinRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const access = {
    assertPermission: jest.fn().mockImplementation(() => {
      if (over.canInvite === false) throw new ForbiddenException('nope');
      return Promise.resolve();
    }),
    assertValidRole: jest.fn().mockImplementation(() => {
      if (over.validRole === false) throw new BadRequestException('bad role');
      return Promise.resolve();
    }),
    assertCanGrantRole: jest.fn().mockImplementation(() => {
      if (over.outranked) throw new ForbiddenException('rank');
      return Promise.resolve();
    }),
    assertNotOutranked: jest.fn().mockImplementation(() => {
      if (over.targetOutranks) throw new ForbiddenException('outranked');
      return Promise.resolve();
    }),
    can: jest.fn().mockImplementation((_u: User, workspaceId: string) =>
      Promise.resolve(
        (over.elsewhere ?? []).find((m) => m.workspaceId === workspaceId)?.callerManages ?? true,
      ),
    ),
    outranked: jest.fn().mockResolvedValue(false),
  } as unknown as WorkspaceAccessService;
  const mapper = { toResponse: jest.fn((u: User) => u) } as unknown as UserMapper;
  const sessions = { revokeAll: jest.fn().mockResolvedValue(undefined) };
  const passwords = { hash: jest.fn(async () => 'hashed') } as unknown as PasswordService;
  const mail = {
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendTemporaryPassword: jest.fn().mockResolvedValue(undefined),
    sendWorkspaceInvitation: jest.fn().mockResolvedValue(undefined),
    delivers: over.mailDelivers ?? true,
  } as unknown as MailService;
  const emit = jest.fn();
  const events = { emit } as unknown as EventEmitter2;
  // Switching an account off goes through UserDeactivationService (its own
  // rules are covered in user-deactivation.service.spec.ts).
  const deactivate = jest.fn().mockImplementation(() =>
    over.deactivationRefuses
      ? Promise.reject(new ForbiddenException(over.deactivationRefuses))
      : Promise.resolve({ deactivated: true }),
  );
  const moduleRef = { get: jest.fn(() => ({ deactivate })) } as unknown as ModuleRef;
  return {
    svc: new UsersService(
      prisma,
      mapper,
      passwords,
      mail,
      access,
      events,
      sessions as never,
      moduleRef,
    ),
    access,
    deactivate,
    sessions,
    userUpdate,
    memberCreate,
    userCreate,
    mail,
    emit,
    prisma,
  };
}

describe('UsersService.invite', () => {
  const dto = { name: 'New', email: 'New@X.com', roleName: 'MANAGER', workspaceId: 'w1' };

  it('requires member:invite — an ordinary member cannot mint a manager account', async () => {
    const { svc, access, memberCreate } = build({ canInvite: false });
    await expect(svc.invite(caller, dto)).rejects.toThrow(ForbiddenException);
    expect(access.assertPermission).toHaveBeenCalledWith(caller, 'w1', 'member:invite');
    expect(memberCreate).not.toHaveBeenCalled();
  });

  it('rejects a display label as the role instead of storing it verbatim', async () => {
    const { svc, memberCreate } = build({ validRole: false });
    await expect(svc.invite(caller, { ...dto, roleName: 'Manager (Admin)' })).rejects.toThrow(
      BadRequestException,
    );
    expect(memberCreate).not.toHaveBeenCalled();
  });

  it('gates the existing-user branch too (silent force-join)', async () => {
    const { svc, memberCreate } = build({
      canInvite: false,
      existingUser: { id: 'u9', email: 'new@x.com' } as User,
    });
    await expect(svc.invite(caller, dto)).rejects.toThrow(ForbiddenException);
    expect(memberCreate).not.toHaveBeenCalled();
  });

  it('refuses a role above the caller’s own, for a new and an existing account alike', async () => {
    for (const existingUser of [null, { id: 'u9', email: 'new@x.com' } as User]) {
      const { svc, access, memberCreate, userCreate } = build({ outranked: true, existingUser });
      await expect(svc.invite(caller, dto)).rejects.toThrow('rank');
      expect(access.assertCanGrantRole).toHaveBeenCalledWith(caller, 'w1', 'MANAGER');
      expect(userCreate).not.toHaveBeenCalled();
      expect(memberCreate).not.toHaveBeenCalled();
    }
  });

  it('creates the user and an ACTIVE membership with the validated role', async () => {
    const { svc, memberCreate, userCreate } = build();
    const res = await svc.invite(caller, dto);
    expect(res).toMatchObject({ status: 201 });
    expect(userCreate.mock.calls[0][0].data).toMatchObject({ email: 'new@x.com', role: 'MANAGER' });
    expect(memberCreate.mock.calls[0][0].data).toMatchObject({ role: 'MANAGER', status: 'ACTIVE' });
  });
});

describe('UsersService.invite — the account has to be reachable', () => {
  const dto = { name: 'New', email: 'new@x.com', roleName: 'MEMBER', workspaceId: 'w1' };
  type Body = { emailSent: boolean; temporaryPassword?: string };

  it('keeps the temporary password to the mail when the mail can be delivered', async () => {
    const { svc } = build({ mailDelivers: true });
    const res = (await svc.invite(caller, dto)) as unknown as { body: Body };
    expect(res.body.emailSent).toBe(true);
    expect(res.body).not.toHaveProperty('temporaryPassword');
  });

  it('hands it to the inviting manager when no mail will arrive', async () => {
    const { svc, mail } = build({ mailDelivers: false });
    const res = (await svc.invite(caller, dto)) as unknown as { body: Body };
    expect(res.body.emailSent).toBe(false);
    // The very password the (undeliverable) welcome mail was given.
    expect(res.body.temporaryPassword).toBe((mail.sendWelcome as jest.Mock).mock.calls[0][2]);
    expect(res.body.temporaryPassword).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/);
  });

  it('never returns a password for an account that already existed', async () => {
    const { svc } = build({
      mailDelivers: false,
      existingUser: { id: 'u9', email: 'new@x.com' } as User,
    });
    const res = (await svc.invite(caller, dto)) as unknown as { body: Body };
    expect(res.body).toMatchObject({ emailSent: false });
    expect(res.body).not.toHaveProperty('temporaryPassword');
  });

  // Adding an address was an oracle for whether it had an account anywhere on
  // the platform: 200 "invitation sent to existing user" against 201 "User
  // created successfully", with a `type` naming which.
  it('answers a new address and an existing account alike', async () => {
    const fresh = await build({ mailDelivers: true }).svc.invite(caller, dto);
    const known = await build({
      mailDelivers: true,
      existingUser: { id: 'u9', email: 'new@x.com' } as User,
    }).svc.invite(caller, dto);
    const shape = (res: unknown) => {
      const { status, body } = res as { status: number; body: Record<string, unknown> };
      const { userId: _userId, ...rest } = body;
      return { status, ...rest };
    };
    expect(shape(known)).toEqual(shape(fresh));
    expect(shape(fresh)).toEqual({
      status: 201,
      success: true,
      message: 'Added to the workspace',
      emailSent: true,
    });
  });

  it('adding an existing account settles their request to join and tells them', async () => {
    const { svc, emit, prisma, mail } = build({
      existingUser: { id: 'u9', email: 'new@x.com' } as User,
    });
    await svc.invite(caller, dto);
    const { updateMany } = (prisma as unknown as { joinRequest: { updateMany: jest.Mock } }).joinRequest;
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', userId: 'u9', status: 'PENDING' },
      data: { status: 'APPROVED', handledById: caller.id },
    });
    expect(emit).toHaveBeenCalledWith(
      'workspace.member.added',
      expect.objectContaining({
        payload: { workspaceId: 'w1', userId: 'u9', role: 'MEMBER', via: 'direct', actorId: expect.any(String) },
      }),
    );
    // The mail names the workspace id, not the dead `Workspace.inviteCode`.
    expect(mail.sendWorkspaceInvitation).toHaveBeenCalledWith('new@x.com', 'W', 'A', 'w1');
  });
});

describe('UsersService.update — field-level authorization', () => {
  it('refuses a self-service write to role/status/workspaceId/email', async () => {
    const { svc } = build();
    for (const dto of [{ role: 'MANAGER' }, { status: 'INACTIVE' }, { email: 'x@y.com' }]) {
      await expect(svc.update(caller, caller.id, dto)).resolves.toEqual({
        softError: { status: 403, message: 'Forbidden' },
      });
    }
  });

  it('still allows self-service profile edits', async () => {
    const { svc } = build();
    await expect(svc.update(caller, caller.id, { name: 'A2' })).resolves.toMatchObject({
      name: 'A2',
    });
  });

  it('validates role and status when a platform admin sets them', async () => {
    const { svc } = build();
    const admin = { ...caller, isSuperuser: true } as User;
    await expect(svc.update(admin, caller.id, { role: 'Manager (Admin)' })).resolves.toEqual({
      softError: { status: 400, message: 'Unknown role "Manager (Admin)".' },
    });
    await expect(svc.update(admin, caller.id, { status: 'nope' })).resolves.toEqual({
      softError: { status: 400, message: 'Unknown status "nope".' },
    });
    await expect(svc.update(admin, caller.id, { role: 'MANAGER' })).resolves.toMatchObject({
      role: 'MANAGER',
    });
  });

  it('a status change moves the flag sign-in actually tests', async () => {
    const { svc } = build();
    // A different account from the one being changed (the lookup returns `caller`).
    const admin = { ...caller, id: 'admin', isSuperuser: true } as User;
    await expect(svc.update(admin, caller.id, { status: 'INACTIVE' })).resolves.toMatchObject({
      status: 'INACTIVE',
      isActive: false,
    });
    await expect(svc.update(admin, caller.id, { status: 'ACTIVE' })).resolves.toMatchObject({
      status: 'ACTIVE',
      isActive: true,
    });
  });

  it('refuses an admin switching their own account off', async () => {
    const { svc, deactivate } = build();
    const admin = { ...caller, isSuperuser: true } as User;
    await expect(svc.update(admin, caller.id, { status: 'INACTIVE' })).resolves.toEqual({
      softError: { status: 400, message: 'You cannot deactivate your own account.' },
    });
    expect(deactivate).not.toHaveBeenCalled();
  });
});

/**
 * Switching an account off used to change the flag and nothing else: every
 * membership stayed ACTIVE, so the account still counted as an approver and as
 * a manager, stayed in the pickers and went on being sent notices.
 */
describe('UsersService.update — switching an account off is a deactivation', () => {
  const admin = { ...caller, id: 'admin', isSuperuser: true } as User;

  it('goes through UserDeactivationService', async () => {
    const { svc, deactivate } = build();
    await svc.update(admin, caller.id, { status: 'INACTIVE' });
    expect(deactivate).toHaveBeenCalledWith(admin, caller.id);
  });

  it('writes nothing when it is refused — an owner, or a workspace’s last manager', async () => {
    const { svc, userUpdate } = build({
      deactivationRefuses: 'A is the last manager of "W".',
    });
    await expect(
      svc.update(admin, caller.id, { status: 'INACTIVE', name: 'Renamed' }),
    ).rejects.toThrow('A is the last manager of "W".');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('switching it back on is the flag alone', async () => {
    const { svc, deactivate } = build();
    await expect(svc.update(admin, caller.id, { status: 'ACTIVE' })).resolves.toMatchObject({
      status: 'ACTIVE',
      isActive: true,
    });
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('is not reached by a profile edit', async () => {
    const { svc, deactivate } = build();
    await svc.update(admin, caller.id, { name: 'A2' });
    expect(deactivate).not.toHaveBeenCalled();
  });
});

describe('UsersService.reissueTempPassword', () => {
  const manager = { id: 'mgr', email: 'm@x.com', name: 'Manager' } as User;
  const platformAdmin = { id: 'root', email: 'r@x.com', name: 'Root', isAdminFlag: true } as User;
  const neverSignedIn = { id: 'u9', email: 'new@x.com', name: 'New', hasTempPassword: true };
  const settled = { ...neverSignedIn, hasTempPassword: false };

  // The first password existed in one place — a mail, or a dialog — and there
  // was no way to make a second: lose it and the account could never be opened.
  it('gives somebody who never signed in a new one, and signs the account out', async () => {
    const { svc, userUpdate, sessions, mail, access } = build({
      membership: { role: 'MEMBER' },
      target: neverSignedIn,
    });
    const result = await svc.reissueTempPassword(manager, 'u9', 'w1');
    expect(access.assertPermission).toHaveBeenCalledWith(manager, 'w1', 'member:update');
    expect(access.assertNotOutranked).toHaveBeenCalledWith(manager, 'w1', 'MEMBER');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u9' },
      data: { password: 'hashed', hasTempPassword: true },
    });
    expect(sessions.revokeAll).toHaveBeenCalledWith('u9');
    expect(mail.sendTemporaryPassword).toHaveBeenCalledWith(
      'new@x.com',
      'New',
      expect.any(String),
      'Manager',
    );
    // Mail delivers here, so the password travels by mail and nowhere else.
    expect(result).toEqual({ success: true, userId: 'u9', emailSent: true });
  });

  it('hands it back, once, where mail cannot be delivered', async () => {
    const { svc } = build({
      membership: { role: 'MEMBER' },
      target: neverSignedIn,
      mailDelivers: false,
    });
    const result = await svc.reissueTempPassword(manager, 'u9', 'w1');
    expect(result.emailSent).toBe(false);
    expect(result.temporaryPassword).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/);
  });

  // The account may reach into workspaces this manager has no say in.
  it('is not a manager’s to do once the person has set their own password', async () => {
    const { svc, userUpdate, sessions } = build({ membership: { role: 'MEMBER' }, target: settled });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(
      /already set their own password/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });

  it('but a platform administrator can', async () => {
    const { svc, userUpdate, access } = build({ membership: { role: 'MEMBER' }, target: settled });
    await svc.reissueTempPassword(platformAdmin, 'u9', 'w1');
    expect(userUpdate).toHaveBeenCalled();
    expect(access.assertPermission).not.toHaveBeenCalled();
  });

  it('refuses a member the caller is outranked by', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MANAGER' },
      target: neverSignedIn,
      targetOutranks: true,
    });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(ForbiddenException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('refuses without member:update', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MEMBER' },
      target: neverSignedIn,
      canInvite: false,
    });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(ForbiddenException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('never resets a platform administrator from inside a workspace', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MEMBER' },
      target: { ...neverSignedIn, isAdminFlag: true },
    });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(
      /platform administrator/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('answers "not found" for somebody who is not in that workspace', async () => {
    const { svc } = build({ membership: null, target: neverSignedIn });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(
      'That user does not exist here.',
    );
  });

  // One account across every workspace it belongs to: a manager of one of them
  // was handed the password of somebody who manages another.
  it('refuses when the person also belongs to a workspace the caller does not manage', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MEMBER' },
      target: neverSignedIn,
      elsewhere: [{ workspaceId: 'w2', role: 'MANAGER', callerManages: false }],
    });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(
      /belongs to a workspace you do not manage/,
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('allows it when the caller manages every workspace the person is in', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MEMBER' },
      target: neverSignedIn,
      elsewhere: [{ workspaceId: 'w2', role: 'MEMBER', callerManages: true }],
    });
    await svc.reissueTempPassword(manager, 'u9', 'w1');
    expect(userUpdate).toHaveBeenCalled();
  });

  it('refuses for somebody whose access to the workspace is switched off', async () => {
    const { svc, userUpdate } = build({
      membership: { role: 'MEMBER', status: 'INACTIVE' } as never,
      target: neverSignedIn,
    });
    await expect(svc.reissueTempPassword(manager, 'u9', 'w1')).rejects.toThrow(/switched off/);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('is not how you change your own', async () => {
    const { svc } = build({ membership: { role: 'MANAGER' }, target: neverSignedIn });
    await expect(svc.reissueTempPassword(manager, 'mgr', 'w1')).rejects.toThrow(
      /your own password/,
    );
  });
});
