import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import { ArchiveService } from './archive.service';
import { TaskDeletionService } from './task-deletion.service';
import { UserDeactivationService } from './user-deactivation.service';
import { WorkspaceDeletionService } from './workspace-deletion.service';

const user = { id: 'u1' } as User;
const access = () => ({ assertPermission: jest.fn().mockResolvedValue(undefined), isPlatformAdmin: () => true }) as never;
const sideEffects = () => ({ emitDeletes: jest.fn(), deleteBlobs: jest.fn().mockResolvedValue(undefined), revokeWebhooks: jest.fn(), purgeGitJobs: jest.fn().mockResolvedValue(undefined) }) as never;

/** tx mock: every delegate returns findMany:[] / deleteMany by default; override per test. */
function txMock(overrides: Record<string, unknown> = {}) {
  return new Proxy(
    { ...overrides },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          delete: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      },
    },
  );
}

describe('ArchiveService', () => {
  it('snapshots rows into retention_archive, then deletes them, returning ids', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      retentionArchive: { createMany },
      attendance: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', workHours: 8 }]), deleteMany },
    };
    const ids = await new ArchiveService().archiveAndDelete(tx as never, {
      model: 'attendance', entityType: 'attendance', where: { workspaceId: 'w1' }, workspaceId: 'w1', reason: 'workspace_deleted:w1',
    });
    expect(ids).toEqual(['a1']);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ entityType: 'attendance', entityId: 'a1', reason: 'workspace_deleted:w1' })] }),
    );
    expect(deleteMany).toHaveBeenCalledWith({ where: { workspaceId: 'w1' } });
  });
});

describe('TaskDeletionService', () => {
  it('deletes comments child-first then the task, and emits realtime frames', async () => {
    const commentDeleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const taskDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = txMock({
      taskComment: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]), deleteMany: commentDeleteMany },
      task: { deleteMany: taskDeleteMany },
    });
    const prisma = {
      task: { findUnique: jest.fn().mockResolvedValue({ id: 't1', workspaceId: 'w1' }) },
      $transaction: (cb: (t: unknown) => unknown) => cb(tx),
    } as unknown as PrismaService;
    const se = sideEffects();
    const svc = new TaskDeletionService(prisma, access(), se);

    await svc.delete(user, 't1');

    expect(commentDeleteMany).toHaveBeenCalled();
    expect(taskDeleteMany).toHaveBeenCalledWith({ where: { id: 't1' } });
    const emitted = (se as unknown as { emitDeletes: jest.Mock }).emitDeletes.mock.calls[0][0];
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'task_comments', id: 'c1' }),
        expect.objectContaining({ collection: 'tasks', id: 't1' }),
      ]),
    );
  });
});

describe('UserDeactivationService (soft delete)', () => {
  it('deactivates, revokes access + tokens, and PRESERVES HR/audit records', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const attendanceDelete = jest.fn();
    const tx = txMock({
      user: { update: userUpdate },
      // If the service ever tried to delete HR, this would be called — it must NOT be.
      attendance: { deleteMany: attendanceDelete, findMany: jest.fn().mockResolvedValue([]) },
    });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE' }) },
      workspaceMember: { findMany: jest.fn().mockResolvedValue([{ id: 'm1', workspaceId: 'w1' }]) },
      $transaction: (cb: (t: unknown) => unknown) => cb(tx),
    } as unknown as PrismaService;
    const tokens = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    const se = sideEffects();
    const svc = new UserDeactivationService(prisma, access(), tokens as never, se);

    const res = await svc.deactivate({ id: 'admin' } as User, 'u1');

    expect(res).toEqual({ deactivated: true });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false, status: 'INACTIVE' } });
    expect(tokens.revokeAll).toHaveBeenCalledWith('u1');
    expect(attendanceDelete).not.toHaveBeenCalled(); // HR preserved
  });

  it('forbids deactivating another user when not a platform admin', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as unknown as PrismaService;
    const nonAdmin = { assertPermission: jest.fn(), isPlatformAdmin: () => false } as never;
    const svc = new UserDeactivationService(prisma, nonAdmin, { revokeAll: jest.fn() } as never, sideEffects());
    await expect(svc.deactivate({ id: 'someone' } as User, 'u1')).rejects.toThrow(/permission/i);
  });
});

describe('WorkspaceDeletionService', () => {
  it('archives HR/audit, deletes the workspace, and runs Zone-2 side effects', async () => {
    const wsDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = txMock({ workspace: { deleteMany: wsDeleteMany } });
    const prisma = {
      workspace: { findUnique: jest.fn().mockResolvedValue({ id: 'w1' }) },
      project: { findMany: jest.fn().mockResolvedValue([]) },
      uploadedFile: { findMany: jest.fn().mockResolvedValue([{ id: 'f1', filePath: 'uploads/w1/f1/a.txt' }]) },
      gitHubIntegration: { findMany: jest.fn().mockResolvedValue([]) },
      gitLabIntegration: { findMany: jest.fn().mockResolvedValue([]) },
      discordIntegration: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: (cb: (t: unknown) => unknown) => cb(tx),
    } as unknown as PrismaService;
    const archive = { archiveAndDelete: jest.fn().mockResolvedValue([]) };
    const se = sideEffects();
    const svc = new WorkspaceDeletionService(prisma, access(), archive as never, se);

    await svc.delete(user, 'w1');

    // 5 archived collections: attendance, leave_request, leave_balance, time_entry, activity_log
    expect(archive.archiveAndDelete).toHaveBeenCalledTimes(5);
    expect(wsDeleteMany).toHaveBeenCalledWith({ where: { id: 'w1' } });
    // Zone 2: blob cleanup for the file + realtime + queue purge
    expect((se as unknown as { deleteBlobs: jest.Mock }).deleteBlobs).toHaveBeenCalledWith([
      { id: 'f1', filePath: 'uploads/w1/f1/a.txt' },
    ]);
    expect((se as unknown as { emitDeletes: jest.Mock }).emitDeletes).toHaveBeenCalled();
  });
});
