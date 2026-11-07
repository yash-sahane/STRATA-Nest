import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
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
      task: { findUnique: jest.fn().mockResolvedValue({ id: 'task-1' }) },
      $transaction: (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceAccessService;
    return { svc: new ActiveTimersService(prisma, access), activeTimer, prisma, access };
  }

  it('retrieve: owner gets their timer', async () => {
    const { svc } = makeService();
    await expect(svc.retrieve(owner, 'timer-1')).resolves.toMatchObject({ id: 'timer-1' });
  });

  it('retrieve: another user gets 404 (not the owner)', async () => {
    const { svc } = makeService();
    await expect(svc.retrieve(attacker, 'timer-1')).rejects.toBeInstanceOf(NotFoundException);
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

/**
 * A timer outlives what it was started for. Once its owner lost the right to
 * log time in its workspace, Stop answered 403, a switch answered 403 and a
 * plain start 409 — and the header chip went on ticking. Its task could be
 * deleted too, taking the only Stop button with it. The timer now says which,
 * and its owner can always throw it away.
 */
describe('ActiveTimersService — a timer that can no longer be filed', () => {
  const owner = { id: 'user-OWNER' } as User;
  const timer = {
    id: 'timer-9',
    userId: owner.id,
    workspaceId: 'ws-left',
    taskId: 'task-gone',
    taskTitle: 'Ship it',
    taskHierarchyId: 'TTV-1',
    projectId: 'p1',
    description: '',
    startTime: new Date(),
    isPaused: false,
    pausedAt: null,
    totalPausedTime: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(opts: { canLog: boolean; taskExists: boolean }) {
    const activeTimer = {
      findUnique: jest.fn().mockResolvedValue(timer),
      findMany: jest.fn().mockResolvedValue([timer]),
      count: jest.fn().mockResolvedValue(1),
      delete: jest.fn().mockResolvedValue(timer),
    };
    const prisma = {
      activeTimer,
      task: { findUnique: jest.fn().mockResolvedValue(opts.taskExists ? { id: 'task-gone' } : null) },
      $transaction: (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn(() =>
        opts.canLog ? Promise.resolve(undefined) : Promise.reject(new ForbiddenException('no')),
      ),
    } as unknown as WorkspaceAccessService;
    return { svc: new ActiveTimersService(prisma, access), activeTimer };
  }

  it('says when its workspace no longer lets its owner log time', async () => {
    const { svc } = makeService({ canLog: false, taskExists: true });
    const { items } = await svc.list(owner, {});
    expect(items[0]).toMatchObject({ id: 'timer-9', canLog: false, taskMissing: false });
  });

  it('says when its task has been deleted', async () => {
    const { svc } = makeService({ canLog: true, taskExists: false });
    await expect(svc.retrieve(owner, 'timer-9')).resolves.toMatchObject({
      canLog: true,
      taskMissing: true,
    });
  });

  it('lets its owner discard it even where they can no longer log time', async () => {
    const { svc, activeTimer } = makeService({ canLog: false, taskExists: false });
    await svc.remove(owner, 'timer-9');
    expect(activeTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-9' } });
  });
});
