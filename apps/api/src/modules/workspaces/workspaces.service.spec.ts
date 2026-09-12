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
    logo: '',
    color: '',
    ownerId: 'u1',
    inviteCode: 'CODE123',
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
  return { svc: new WorkspacesService(prisma, access, new EventEmitter2()), prisma };
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
  }) {
    const findMany = jest.fn().mockResolvedValue(opts.all ?? []);
    const prisma = {
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue((opts.memberships ?? []).map((workspaceId) => ({ workspaceId }))),
      },
      joinRequest: {
        findMany: jest.fn().mockResolvedValue((opts.pending ?? []).map((workspaceId) => ({ workspaceId }))),
      },
      workspace: { findMany },
    } as unknown as PrismaService;
    const access = { isPlatformAdmin: jest.fn().mockReturnValue(false) } as unknown as WorkspaceAccessService;
    return { svc: new WorkspacesService(prisma, access, new EventEmitter2()), findMany };
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
