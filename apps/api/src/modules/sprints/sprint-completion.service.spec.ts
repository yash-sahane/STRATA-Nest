import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type { Sprint, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { SprintCompletionService } from './sprint-completion.service';

const user = { id: 'u1', name: 'U' } as User;

const stored = {
  id: 's1',
  workspaceId: 'w1',
  projectId: 'p1',
  name: 'Sprint 1',
  goal: '',
  startDate: new Date('2026-08-11T00:00:00.000Z'),
  endDate: new Date('2026-08-20T00:00:00.000Z'),
  status: 'ACTIVE',
  retrospectiveNotes: '',
  createdById: 'u1',
  createdByName: 'U',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as Sprint;

/**
 * `total` tasks in the sprint, `done` of them finished. `writtenStatus` is what
 * the row holds by the time the conditional write runs — another completion
 * may have landed in between.
 */
function build(
  status: string,
  counts: { total: number; done: number } = { total: 0, done: 0 },
  writtenStatus = status,
  projectStatus = 'ACTIVE',
) {
  let saved: Record<string, unknown> = { ...stored, status: writtenStatus };
  const update = jest.fn(
    ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
      if (saved.status !== where.status) return Promise.resolve({ count: 0 });
      saved = { ...saved, ...data };
      return Promise.resolve({ count: 1 });
    },
  );
  const prisma = {
    sprint: {
      findUnique: jest.fn().mockResolvedValue({ ...stored, status }),
      updateMany: update,
      findUniqueOrThrow: jest.fn(() => Promise.resolve(saved)),
    },
    announceWrite: jest.fn(),
    // The sprint's project (see project-archive).
    project: { findUnique: jest.fn().mockResolvedValue({ status: projectStatus }) },
    task: {
      count: jest.fn(({ where }: { where: { status?: string } }) =>
        Promise.resolve(where.status === 'DONE' ? counts.done : counts.total),
      ),
      findMany: jest.fn().mockResolvedValue([{ assigneeIds: ['u2'] }, { assigneeIds: ['u2', 'u3'] }]),
    },
  } as unknown as PrismaService;
  const access = {
    assertPermission: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceAccessService;
  const emitAsync = jest.fn().mockResolvedValue([]);
  const events = { emitAsync } as unknown as EventEmitter2;
  return { svc: new SprintCompletionService(prisma, access, events), update, emitAsync };
}

describe('SprintCompletionService', () => {
  // Completing records what a sprint got through. One still being planned got
  // through nothing, and closing it rolled its whole plan back to the backlog
  // under a sprint that reads "Completed".
  it('refuses to complete a sprint that was never started', async () => {
    const { svc, update, emitAsync } = build('PLANNING');
    await expect(svc.complete(user, 's1')).rejects.toThrow(
      'Only a sprint that has been started can be completed.',
    );
    expect(update).not.toHaveBeenCalled();
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('refuses to complete a sprint twice', async () => {
    const { svc, update } = build('COMPLETED');
    await expect(svc.complete(user, 's1')).rejects.toThrow('Sprint already completed');
    expect(update).not.toHaveBeenCalled();
  });

  it('closes a running sprint and records what it got through', async () => {
    const { svc, update, emitAsync } = build('ACTIVE', { total: 5, done: 3 });
    await svc.complete(user, 's1');
    expect(update.mock.calls[0][0].data).toMatchObject({
      status: 'COMPLETED',
      totalTaskCount: 5,
      completedTaskCount: 3,
      rolledOverTaskCount: 2,
    });
    // Everyone who had work in it is named once, for the roll-out and the notice.
    expect(emitAsync.mock.calls[0][1].payload).toMatchObject({
      sprintId: 's1',
      assigneeIds: ['u2', 'u3'],
    });
  });

  // Two clicks, or two people: both read ACTIVE. Only one completes it; the
  // other is told, and nothing is rolled out or announced a second time.
  it('completes a sprint once when two completions race', async () => {
    const { svc, emitAsync } = build('ACTIVE', { total: 5, done: 3 }, 'COMPLETED');
    await expect(svc.complete(user, 's1')).rejects.toThrow(/completed or changed this sprint/);
    expect(emitAsync).not.toHaveBeenCalled();
  });
});
