import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { NotificationPreferencesService } from './notification-preferences.service';

const user = { id: 'u1' } as User;

function svcWith(row: { inApp: boolean; email: boolean } | null) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const findMany = jest.fn().mockResolvedValue([]);
  const upsert = jest.fn((args: unknown) => args);
  const $transaction = jest.fn().mockResolvedValue([]);
  const prisma = {
    notificationPreference: { findUnique, findMany, upsert },
    $transaction,
  } as unknown as PrismaService;
  const assertMember = jest.fn().mockResolvedValue(undefined);
  const access = { assertMember } as unknown as WorkspaceAccessService;
  return {
    svc: new NotificationPreferencesService(prisma, access),
    findUnique,
    findMany,
    upsert,
    assertMember,
  };
}

describe('NotificationPreferencesService.allows', () => {
  it('allows delivery when the user set no preference (opt-out model)', async () => {
    const { svc } = svcWith(null);
    await expect(svc.allows('w1', 'u2', 'TASK_ASSIGNED', 'inApp')).resolves.toBe(true);
  });

  it('blocks the channel the user turned off, per channel', async () => {
    const { svc } = svcWith({ inApp: false, email: true });
    await expect(svc.allows('w1', 'u2', 'TASK_ASSIGNED', 'inApp')).resolves.toBe(false);
    await expect(svc.allows('w1', 'u2', 'TASK_ASSIGNED', 'email')).resolves.toBe(true);
  });

  it('matches the server’s snake_case event names against the UI’s SCREAMING_SNAKE types', async () => {
    const { svc, findUnique } = svcWith({ inApp: false, email: false });

    await expect(svc.allows('w1', 'u2', 'leave_approved', 'inApp')).resolves.toBe(false);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_userId_type: { workspaceId: 'w1', userId: 'u2', type: 'LEAVE_APPROVED' },
        },
      }),
    );
  });

  it('fails OPEN so a preference outage never silences notifications', async () => {
    const { svc, findUnique } = svcWith(null);
    findUnique.mockRejectedValue(new Error('relation does not exist'));

    await expect(svc.allows('w1', 'u2', 'TASK_ASSIGNED', 'inApp')).resolves.toBe(true);
  });
});

describe('NotificationPreferencesService.replaceMine', () => {
  it('writes rows for the CALLER only, and requires workspace membership', async () => {
    const { svc, upsert, assertMember } = svcWith(null);

    await svc.replaceMine(user, {
      workspaceId: 'w1',
      preferences: [{ type: 'task_assigned', inApp: false, email: true }],
    });

    expect(assertMember).toHaveBeenCalledWith(user, 'w1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_userId_type: { workspaceId: 'w1', userId: 'u1', type: 'TASK_ASSIGNED' },
        },
        update: { inApp: false, email: true },
      }),
    );
  });

  it('collapses duplicate types in one payload to a single upsert', async () => {
    const { svc, upsert } = svcWith(null);

    await svc.replaceMine(user, {
      workspaceId: 'w1',
      preferences: [
        { type: 'TASK_ASSIGNED', inApp: true, email: true },
        { type: 'task_assigned', inApp: false, email: false },
      ],
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { inApp: false, email: false } }),
    );
  });
});
