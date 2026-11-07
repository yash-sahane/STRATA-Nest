import { ForbiddenException } from '@nestjs/common';
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // The entry names the timer's project, read from the project.
    const project = { findUnique: jest.fn().mockResolvedValue({ name: 'Time Travel' }) };
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
      project,
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

const HOUR = 60 * 60_000;

/**
 * Builds a TimerService around one running timer, with the switches the cases
 * below turn: how long ago it started, whether its owner may still log time in
 * its workspace.
 */
function buildTimer(opts: { startedMsAgo: number; canLog?: boolean; workspaceId?: string }) {
  const user = { id: 'user-1', name: 'Dev', email: 'dev@strata.local' } as User;
  const running = {
    id: 'timer-1',
    userId: user.id,
    workspaceId: opts.workspaceId ?? 'ws-old',
    taskId: 'task-1',
    taskTitle: 'Ship it',
    taskHierarchyId: 'TTV-1',
    projectId: 'project-1',
    description: 'Working on TTV-1',
    startTime: new Date(Date.now() - opts.startedMsAgo),
    isPaused: false,
    pausedAt: null,
    totalPausedTime: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const activeTimer = {
    findUnique: jest.fn().mockResolvedValue(running),
    delete: jest.fn().mockResolvedValue(running),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        isPaused: false,
        pausedAt: null,
        totalPausedTime: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
  };
  const timeEntry = {
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
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
    project: { findUnique: jest.fn().mockResolvedValue({ name: 'Time Travel' }) },
    task: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'task-2',
        title: 'Next thing',
        hierarchyId: 'TTV-2',
        projectId: 'project-2',
        workspaceId: 'ws-new',
      }),
    },
    $transaction: (ops: unknown[]) => Promise.all(ops),
  } as unknown as PrismaService;
  const access = {
    // Logging time is refused only in the timer's own (old) workspace.
    assertPermission: jest.fn((_user: User, workspaceId: string) =>
      opts.canLog === false && workspaceId === running.workspaceId
        ? Promise.reject(new ForbiddenException('no'))
        : Promise.resolve(undefined),
    ),
  } as unknown as WorkspaceAccessService;
  return { svc: new TimerService(prisma, access), user, running, activeTimer, timeEntry };
}

/**
 * A timer left running over a weekend filed a 64-hour entry — the rule a
 * typed-in entry has (24 hours at most) did not apply to it. It is refused now,
 * with the timer kept, and its owner can say when they actually stopped.
 */
describe('TimerService.stop — the 24-hour rule', () => {
  it('refuses to file a run longer than a day, and keeps the timer', async () => {
    const { svc, user, activeTimer, timeEntry } = buildTimer({ startedMsAgo: 64 * HOUR });
    await expect(svc.stop(user, { workspaceId: 'ws-old' })).rejects.toMatchObject({
      response: expect.objectContaining({ type: 'TimerTooLong' }),
    });
    expect(timeEntry.create).not.toHaveBeenCalled();
    expect(activeTimer.delete).not.toHaveBeenCalled();
  });

  it('files it once its owner says when they stopped', async () => {
    const { svc, user, running, timeEntry } = buildTimer({ startedMsAgo: 64 * HOUR });
    const end = new Date(running.startTime.getTime() + 8 * HOUR);
    const entry = await svc.stop(user, { workspaceId: 'ws-old', endTime: end.toISOString() });
    expect(entry).toMatchObject({ duration: 8 * 60 });
    expect(timeEntry.create.mock.calls[0][0].data).toMatchObject({ endTime: end });
  });

  it('still refuses a stated end that leaves more than a day', async () => {
    const { svc, user, running } = buildTimer({ startedMsAgo: 64 * HOUR });
    const end = new Date(running.startTime.getTime() + 30 * HOUR);
    await expect(
      svc.stop(user, { workspaceId: 'ws-old', endTime: end.toISOString() }),
    ).rejects.toThrow(/at most 24 hours/);
  });

  it('refuses an end before the start, or one still to come', async () => {
    const { svc, user, running } = buildTimer({ startedMsAgo: 2 * HOUR });
    const before = new Date(running.startTime.getTime() - HOUR).toISOString();
    await expect(svc.stop(user, { workspaceId: 'ws-old', endTime: before })).rejects.toThrow(
      /after the timer started/,
    );
    const later = new Date(Date.now() + 2 * HOUR).toISOString();
    await expect(svc.stop(user, { workspaceId: 'ws-old', endTime: later })).rejects.toThrow(
      /has not come yet/,
    );
  });
});

/**
 * Its owner left the workspace (or lost the right to log time there). Stop was
 * a bare 403, and "log that time and start here" was too, because it filed the
 * old timer first: nothing could ever end it.
 */
describe('TimerService — a timer whose workspace its owner can no longer log time in', () => {
  it('Stop says why it cannot be filed, and points at discarding it', async () => {
    const { svc, user, timeEntry } = buildTimer({ startedMsAgo: HOUR, canLog: false });
    await expect(svc.stop(user, { workspaceId: 'ws-old' })).rejects.toMatchObject({
      response: expect.objectContaining({ type: 'TimerNotLoggable' }),
    });
    expect(timeEntry.create).not.toHaveBeenCalled();
  });

  it('a switch discards it instead of filing it, and says so', async () => {
    const { svc, user, activeTimer, timeEntry } = buildTimer({ startedMsAgo: HOUR, canLog: false });
    const started = await svc.start(user, { taskId: 'task-2', replace: true });
    expect(timeEntry.create).not.toHaveBeenCalled();
    expect(activeTimer.delete).toHaveBeenCalledWith({ where: { id: 'timer-1' } });
    expect(started).toMatchObject({
      taskId: 'task-2',
      workspaceId: 'ws-new',
      replaced: { logged: false },
    });
  });

  it('a switch still logs a timer that can be filed', async () => {
    const { svc, user, timeEntry } = buildTimer({ startedMsAgo: HOUR });
    const started = await svc.start(user, { taskId: 'task-2', replace: true });
    expect(timeEntry.create).toHaveBeenCalled();
    expect(started).toMatchObject({ replaced: { logged: true } });
  });

  it('a switch never throws away a run that is merely too long to file as it stands', async () => {
    const { svc, user, activeTimer } = buildTimer({ startedMsAgo: 64 * HOUR });
    await expect(svc.start(user, { taskId: 'task-2', replace: true })).rejects.toThrow(
      /more than one entry can cover/,
    );
    expect(activeTimer.delete).not.toHaveBeenCalled();
    expect(activeTimer.create).not.toHaveBeenCalled();
  });
});
