import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { PasswordService } from '../auth/services/password.service';
import type { MailService } from '../mail/mail.service';
import type { UserMapper } from './user.mapper';
import { UsersService } from './users.service';

const caller = { id: 'u1', email: 'a@x.com', name: 'A' } as User;

function build(over: { canInvite?: boolean; validRole?: boolean; existingUser?: User | null } = {}) {
  const memberCreate = jest.fn().mockResolvedValue({ id: 'm1' });
  const userCreate = jest.fn().mockImplementation(({ data }) => data);
  const userUpdate = jest.fn().mockImplementation(({ data }) => data);
  const prisma = {
    workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'w1', name: 'W', ownerId: 'someone-else', inviteCode: 'C' }) },
    workspaceMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([{ workspaceId: 'w1' }]),
      create: memberCreate,
    },
    user: {
      // `{ AND: [...] }` is the scoped id lookup (retrieve/update); a bare
      // `email` filter is invite()'s existing-account probe.
      findFirst: jest.fn().mockImplementation((args: { where?: { AND?: unknown } }) =>
        Array.isArray(args?.where?.AND) ? caller : (over.existingUser ?? null),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: userCreate,
      update: userUpdate,
    },
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
  } as unknown as WorkspaceAccessService;
  const mapper = { toResponse: jest.fn((u: User) => u) } as unknown as UserMapper;
  const passwords = { hash: jest.fn(() => 'hashed') } as unknown as PasswordService;
  const mail = {
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendWorkspaceInvitation: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;
  return { svc: new UsersService(prisma, mapper, passwords, mail, access), access, memberCreate, userCreate };
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

  it('creates the user and an ACTIVE membership with the validated role', async () => {
    const { svc, memberCreate, userCreate } = build();
    const res = await svc.invite(caller, dto);
    expect(res).toMatchObject({ status: 201 });
    expect(userCreate.mock.calls[0][0].data).toMatchObject({ email: 'new@x.com', role: 'MANAGER' });
    expect(memberCreate.mock.calls[0][0].data).toMatchObject({ role: 'MANAGER', status: 'ACTIVE' });
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
});
