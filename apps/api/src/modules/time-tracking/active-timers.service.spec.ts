import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { ActiveTimersService } from './time-tracking.services';

/**
 * Security regression guard: an ActiveTimer is tied to a single user, so no
 * caller may read, mutate, or delete another user's timer by id (closes the
 * cross-user IDOR where these endpoints operated on a bare id).
 */
describe('ActiveTimersService — per-user ownership scoping', () => {
  const owner = { id: 'user-OWNER' } as User;
  const attacker = { id: 'user-ATTACKER' } as User;
  const row = {
    id: 'timer-1',
    userId: owner.id,
    taskId: '',
    taskTitle: '',
    taskHierarchyId: '',
    projectId: '',
    description: '',
    startTime: new Date(),
    isPaused: false,
    pausedAt: null,
    totalPausedTime: 0,
    type: 'TIMER',
    pomodoroSettings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides: Record<string, jest.Mock> = {}) {
    const activeTimer = {
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue(row),
      ...overrides,
    };
    const prisma = {
      activeTimer,
      $transaction: (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;
    return { svc: new ActiveTimersService(prisma), activeTimer };
  }

  it('retrieve: owner gets their timer', async () => {
    const { svc } = makeService();
    await expect(svc.retrieve(owner, 'timer-1')).resolves.toMatchObject({ id: 'timer-1' });
  });

  it('retrieve: another user gets 404 (not the owner)', async () => {
    const { svc } = makeService();
    await expect(svc.retrieve(attacker, 'timer-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: another user cannot mutate the owner’s timer', async () => {
    const { svc, activeTimer } = makeService();
    await expect(svc.update(attacker, 'timer-1', { isPaused: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(activeTimer.update).not.toHaveBeenCalled();
  });

  it('remove: another user cannot delete the owner’s timer', async () => {
    const { svc, activeTimer } = makeService();
    await expect(svc.remove(attacker, 'timer-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(activeTimer.delete).not.toHaveBeenCalled();
  });

  it('list: query is forced to the caller’s own userId (ignores a spoofed filter)', async () => {
    const { svc, activeTimer } = makeService();
    await svc.list(owner, { userId: attacker.id });
    const call = activeTimer.findMany.mock.calls[0][0] as { where: { userId: string } };
    expect(call.where.userId).toBe(owner.id);
  });
});
