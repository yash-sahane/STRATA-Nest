import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { WorkspacesService } from './workspaces.service';

const user = { id: 'u1', name: 'Ada' } as User;

function build(platformAdmin: boolean) {
  const row = {
    id: 'w1',
    name: 'Acme',
    description: '',
    ownerId: 'u1',
    settings: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const prisma = {
    workspace: { create: jest.fn().mockReturnValue({ op: 'workspace' }) },
    workspaceMember: { create: jest.fn().mockReturnValue({ op: 'member' }) },
    $transaction: jest.fn().mockResolvedValue([row]),
  } as unknown as PrismaService;
  const access = {
    isPlatformAdmin: jest.fn().mockReturnValue(platformAdmin),
  } as unknown as WorkspaceAccessService;
  return { svc: new WorkspacesService(prisma, access, new EventEmitter2(), {} as never), prisma };
}

describe('WorkspacesService.create — workspace creation is admin-only', () => {
  it('refuses a non-admin, who would otherwise mint a tenant they fully manage', async () => {
    const { svc, prisma } = build(false);
    await expect(svc.create(user, { name: 'Acme' })).rejects.toThrow(
      'Only administrators can create workspaces',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets an administrator create one, as owner and ACTIVE MANAGER member', async () => {
    const { svc, prisma } = build(true);
    await expect(svc.create(user, { name: 'Acme' })).resolves.toMatchObject({
      id: 'w1',
      ownerId: 'u1',
      memberIds: ['u1'],
    });
    expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', role: 'MANAGER', status: 'ACTIVE' }),
      }),
    );
  });
});

describe('WorkspacesService.directory — what a non-member may discover', () => {
  function buildDirectory(opts: {
    memberships?: string[];
    pending?: string[];
    all?: Array<{ id: string; name: string }>;
    switchedOff?: string[];
    declined?: string[];
  }) {
    const findMany = jest.fn().mockResolvedValue(opts.all ?? []);
    const prisma = {
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
          ...(opts.memberships ?? []).map((workspaceId) => ({ workspaceId, status: 'ACTIVE' })),
          ...(opts.switchedOff ?? []).map((workspaceId) => ({ workspaceId, status: 'INACTIVE' })),
        ]),
      },
      // One row per workspace: its status is the latest word on the request.
      joinRequest: {
        findMany: jest.fn().mockResolvedValue([
          ...(opts.pending ?? []).map((workspaceId) => ({ workspaceId, status: 'PENDING', updatedAt: new Date() })),
          ...(opts.declined ?? []).map((workspaceId) => ({
            workspaceId,
            status: 'REJECTED',
            updatedAt: new Date('2026-10-01T10:00:00.000Z'),
          })),
        ]),
      },
      workspace: { findMany },
    } as unknown as PrismaService;
    const access = { isPlatformAdmin: jest.fn().mockReturnValue(false) } as unknown as WorkspaceAccessService;
    return { svc: new WorkspacesService(prisma, access, new EventEmitter2(), {} as never), findMany };
  }

  it('excludes workspaces the caller already belongs to', async () => {
    const { svc, findMany } = buildDirectory({ memberships: ['w1', 'w2'] });
    await svc.directory(user);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { notIn: ['w1', 'w2'] } });
  });

  it('discloses only id and name — never members, settings or invite codes', async () => {
    const { svc, findMany } = buildDirectory({});
    await svc.directory(user);
    expect(findMany.mock.calls[0][0].select).toEqual({ id: true, name: true });
  });

  // A switched-off membership hid the workspace as if the person were still in
  // it — while asking is exactly how they get switched back on.
  it('lists a workspace whose access was switched off, marked so', async () => {
    const { svc, findMany } = buildDirectory({
      switchedOff: ['w5'],
      all: [{ id: 'w5', name: 'Switched off' }],
    });
    const rows = await svc.directory(user);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { notIn: [] } });
    expect(rows).toEqual([{ id: 'w5', name: 'Switched off', requested: false, accessSwitchedOff: true }]);
  });

  it('says when the last request was declined', async () => {
    const { svc } = buildDirectory({ declined: ['w7'], all: [{ id: 'w7', name: 'Declined' }] });
    const rows = await svc.directory(user);
    expect(rows).toEqual([
      { id: 'w7', name: 'Declined', requested: false, declinedAt: '2026-10-01T10:00:00.000Z' },
    ]);
  });

  it('flags a workspace the caller has already asked to join', async () => {
    const { svc } = buildDirectory({
      pending: ['w9'],
      all: [
        { id: 'w9', name: 'Already asked' },
        { id: 'w8', name: 'Not asked' },
      ],
    });
    const rows = await svc.directory(user);
    expect(rows).toEqual([
      { id: 'w9', name: 'Already asked', requested: true },
      { id: 'w8', name: 'Not asked', requested: false },
    ]);
  });
});

describe('WorkspacesService.update — settings are a contract, not a bag', () => {
  function buildUpdate() {
    const row = {
      id: 'w1',
      name: 'Acme',
      description: '',
      ownerId: 'u1',
      settings: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data }));
    const prisma = {
      workspace: { findFirst: jest.fn().mockResolvedValue(row), update },
      workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const access = {
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceAccessService;
    return { svc: new WorkspacesService(prisma, access, new EventEmitter2(), {} as never), update };
  }

  it('stores the working hours a workspace declares', async () => {
    const { svc, update } = buildUpdate();
    await svc.update(user, 'w1', {
      settings: { timezone: 'Asia/Kolkata', workdayStart: '09:30', lateGraceMinutes: 10 },
    });
    expect(update.mock.calls[0][0].data.settings).toEqual({
      timezone: 'Asia/Kolkata',
      workdayStart: '09:30',
      lateGraceMinutes: 10,
    });
  });

  it('keeps nothing it has no reader for, and treats a blank as withdrawn', async () => {
    const { svc, update } = buildUpdate();
    await svc.update(user, 'w1', {
      settings: {
        timezone: '',
        workdayStart: null,
        isPublic: true,
        allowMemberInvites: true,
        requireTaskApproval: true,
      },
    });
    expect(update.mock.calls[0][0].data.settings).toEqual({});
  });

  it.each([
    [{ timezone: 'Mars/Olympus_Mons' }, 'is not a recognised IANA timezone'],
    [{ workdayStart: '25:00' }, 'is not a time of day'],
    [{ workdayStart: '9am' }, 'is not a time of day'],
    [{ lateGraceMinutes: -1 }, 'grace period'],
    [{ lateGraceMinutes: 7.5 }, 'grace period'],
    [{ lateGraceMinutes: '15' }, 'grace period'],
    [{ lateGraceMinutes: 1000 }, 'grace period'],
  ])('refuses %j rather than storing a value nothing would honour', async (settings, reason) => {
    const { svc, update } = buildUpdate();
    await expect(svc.update(user, 'w1', { settings })).rejects.toThrow(reason);
    expect(update).not.toHaveBeenCalled();
  });
});
