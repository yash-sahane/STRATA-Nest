import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TimerService } from './time-tracking.workflows';

/**
 * Regression guard: starting a timer and stopping it again straight away used
 * to write a PENDING entry with duration 0, so the approvals queue filled with
 * "0m" rows a manager had to decide on. A run that rounds below a minute is
 * discarded — the timer goes away, nothing is logged, nobody is asked.
 */
describe('TimerService.stop — a run too short to log', () => {
  const user = { id: 'user-1', name: 'Dev', email: 'dev@strata.local' } as User;

  function makeService(startedMsAgo: number) {
    const timer = {
      id: 'timer-1',
      userId: user.id,
      taskId: 'task-1',
      taskTitle: 'Ship it',
      taskHierarchyId: 'TTV-1',
      projectId: 'project-1',
      description: 'Working on TTV-1',
      startTime: new Date(Date.now() - startedMsAgo),
      isPaused: false,
      pausedAt: null,
      totalPausedTime: 0,
      type: 'TIMER',
      pomodoroSettings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const activeTimer = {
      findUnique: jest.fn().mockResolvedValue(timer),
      delete: jest.fn().mockResolvedValue(timer),
    };
    const timeEntry = {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...data,
          projectName: '',
          approvedBy: '',
          approvedAt: null,
          rejectionReason: '',
          tags: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
    };
    const prisma = {
      activeTimer,
      timeEntry,
      $transaction: (ops: unknown[]) => Promise.all(ops),
    } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceAccessService;
    return { svc: new TimerService(prisma, access), activeTimer, timeEntry };
  }

  it('writes no entry for a few seconds of work, and still drops the timer', async () => {
    const { svc, activeTimer, timeEntry } = makeService(3_000);
    const res = await svc.stop(user, { workspaceId: 'ws-1' });
    expect(res).toMatchObject({ discarded: true, minimumMinutes: 1 });
    expect(timeEntry.create).not.toHaveBeenCalled();
    expect(activeTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-1' } });
  });

  it('still logs a real run', async () => {
    const { svc, timeEntry } = makeService(90 * 60_000);
    const res = await svc.stop(user, { workspaceId: 'ws-1' });
    expect(timeEntry.create).toHaveBeenCalled();
    expect(res).toMatchObject({ duration: 90, status: 'PENDING' });
  });
});
