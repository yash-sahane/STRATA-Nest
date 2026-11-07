import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import type Redis from 'ioredis';
import { WorkerEventsBridge } from './worker-events.bridge';

/**
 * A commit that says "fixes #ID" moves the task to Review — in the worker, which
 * has no event bus and no sockets. The move used to be the only part that
 * happened: no reviewer was told, and an open board kept the card where it was.
 */
describe('WorkerEventsBridge', () => {
  const task = {
    id: 't1',
    workspaceId: 'w1',
    projectId: 'p1',
    title: 'Card form',
    hierarchyId: 'PAY-T-01',
    status: 'REVIEW',
    assigneeIds: ['u2'],
    sprintId: 's1',
    functionalRequirementId: 'fr1',
    epicId: 'e1',
  };

  function build() {
    const announceWrite = jest.fn();
    const emit = jest.fn();
    const prisma = {
      task: { findMany: jest.fn().mockResolvedValue([task]) },
      functionalRequirement: { findMany: jest.fn().mockResolvedValue([{ id: 'fr1' }]) },
      epic: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      announceWrite,
    } as unknown as PrismaService;
    const claimed = new Set<string>();
    const redis = {
      set: jest.fn(async (key: string) => {
        if (claimed.has(key)) return null;
        claimed.add(key);
        return 'OK';
      }),
    };
    const bridge = new WorkerEventsBridge(
      redis as unknown as Redis,
      prisma,
      { emit } as unknown as EventEmitter2,
    );
    return { bridge, announceWrite, emit };
  }

  // Pub/sub delivers to every API instance; two replicas told the reviewers twice.
  it('acts on a message once, however many instances hear it', async () => {
    const { bridge, emit } = build();
    const once = JSON.stringify({ ...JSON.parse(moved), id: 'evt-1' });
    await bridge.handle(once);
    await bridge.handle(once);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  const moved = JSON.stringify({
    kind: 'tasks.moved_by_commit',
    projectId: 'p1',
    moves: [{ taskId: 't1', from: 'IN_PROGRESS' }],
    commit: { sha: 'abcdef1234567890', author: 'Dana Dev' },
  });

  it('says the same two things an edit through the API does', async () => {
    const { bridge, announceWrite, emit } = build();
    await bridge.handle(moved);
    // Open screens are told the row changed...
    expect(announceWrite).toHaveBeenCalledWith('Task', 'update', task);
    // ...and the status change is an event like any other, so the reviewers are
    // notified by the code that notifies them when a person presses the button.
    expect(emit).toHaveBeenCalledWith(
      'task.status_changed',
      expect.objectContaining({
        workspaceId: 'w1',
        payload: expect.objectContaining({
          taskId: 't1',
          from: 'IN_PROGRESS',
          to: 'REVIEW',
          assigneeIds: ['u2'],
          // Nobody signed in did it, so nobody is left out for having done it.
          actorId: '',
          actorName: 'Dana Dev (commit abcdef1)',
        }),
      }),
    );
  });

  it('announces the requirement and epic the worker re-summed', async () => {
    const { bridge, announceWrite } = build();
    await bridge.handle(moved);
    expect(announceWrite).toHaveBeenCalledWith('FunctionalRequirement', 'update', { id: 'fr1' });
    expect(announceWrite).toHaveBeenCalledWith('Epic', 'update', { id: 'e1' });
  });

  it('ignores what it does not understand', async () => {
    const { bridge, announceWrite, emit } = build();
    await bridge.handle('not json');
    await bridge.handle(JSON.stringify({ kind: 'something.else' }));
    expect(announceWrite).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
