import type { PrismaService } from '@strata/prisma';
import { writeAuditRow } from './audit-writer';

function build(create = jest.fn().mockResolvedValue({})) {
  const prisma = { activityLog: { create } } as unknown as PrismaService;
  return { prisma, create };
}

const dataOf = (create: jest.Mock) => create.mock.calls[0][0].data as Record<string, unknown>;

describe('writeAuditRow', () => {
  it('records the dotted action, entity and actor', async () => {
    const { prisma, create } = build();
    await writeAuditRow(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      entity: 'task',
      action: 'created',
      entityId: 't1',
    });
    expect(dataOf(create)).toMatchObject({
      workspaceId: 'w1',
      userId: 'u1',
      action: 'task.created',
      entityType: 'task',
      entityId: 't1',
    });
  });

  it('stores only the NAMES of changed fields, never their values', async () => {
    const { prisma, create } = build();
    await writeAuditRow(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      entity: 'task',
      action: 'updated',
      entityId: 't1',
      changedFields: ['title', 'status'],
    });
    expect(dataOf(create).changes).toEqual({ fields: ['title', 'status'] });
  });

  it('drops credential-bearing field names so the trail cannot leak them', async () => {
    const { prisma, create } = build();
    await writeAuditRow(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      entity: 'github_integration',
      action: 'updated',
      entityId: 'g1',
      changedFields: ['repoName', 'accessToken', 'webhookSecret', 'password', 'token'],
    });
    expect(dataOf(create).changes).toEqual({ fields: ['repoName'] });
  });

  it('carries a human-readable label from title or name', async () => {
    const { prisma, create } = build();
    await writeAuditRow(prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      entity: 'task',
      action: 'created',
      entityId: 't1',
      row: { title: 'Build login form' },
    });
    expect(dataOf(create).metadata).toEqual({ label: 'Build login form' });

    const second = build();
    await writeAuditRow(second.prisma, {
      workspaceId: 'w1',
      userId: 'u1',
      entity: 'epic',
      action: 'created',
      entityId: 'e1',
      row: { name: 'Authentication' },
    });
    expect(dataOf(second.create).metadata).toEqual({ label: 'Authentication' });
  });

  it.each([
    ['no workspace', { workspaceId: undefined, entity: 'task', entityId: 't1' }],
    ['no entity', { workspaceId: 'w1', entity: '', entityId: 't1' }],
    ['no entity id', { workspaceId: 'w1', entity: 'task', entityId: '' }],
  ])('writes nothing when there is %s', async (_label, partial) => {
    const { prisma, create } = build();
    await writeAuditRow(prisma, {
      userId: 'u1',
      action: 'created',
      ...(partial as { workspaceId?: string; entity: string; entityId: string }),
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('swallows a write failure — the trail must never break the write it records', async () => {
    const { prisma } = build(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(
      writeAuditRow(prisma, {
        workspaceId: 'w1',
        userId: 'u1',
        entity: 'task',
        action: 'created',
        entityId: 't1',
      }),
    ).resolves.toBeUndefined();
  });
});
