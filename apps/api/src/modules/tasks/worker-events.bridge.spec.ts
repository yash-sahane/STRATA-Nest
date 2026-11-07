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

  function build(
    opts: { account?: { id: string } | null; membership?: { status: string } | null; auditFails?: boolean } = {},
  ) {
    const announceWrite = jest.fn();
    const emit = jest.fn();
    const auditCreate = opts.auditFails
      ? jest.fn().mockRejectedValue(new Error('activity log down'))
      : jest.fn().mockResolvedValue({});
    const findUser = jest.fn().mockResolvedValue(opts.account === undefined ? { id: 'u-dana' } : opts.account);
    const findMembership = jest
      .fn()
      .mockResolvedValue(opts.membership === undefined ? { status: 'ACTIVE' } : opts.membership);
    const prisma = {
      task: { findMany: jest.fn().mockResolvedValue([task]) },
      functionalRequirement: { findMany: jest.fn().mockResolvedValue([{ id: 'fr1' }]) },
      epic: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      activityLog: { create: auditCreate },
      user: { findUnique: findUser },
      workspaceMember: { findUnique: findMembership },
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
    return { bridge, announceWrite, emit, auditCreate, findUser, findMembership };
  }

  // Pub/sub delivers to every API instance; two replicas told the reviewers twice.
  it('acts on a message once, however many instances hear it', async () => {
    const { bridge, emit, auditCreate } = build();
    const once = JSON.stringify({ ...JSON.parse(moved), id: 'evt-1' });
    await bridge.handle(once);
    await bridge.handle(once);
    expect(emit).toHaveBeenCalledTimes(1);
    // ...and wrote the move into the trail once, not once per instance.
    expect(auditCreate).toHaveBeenCalledTimes(1);
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
    const { bridge, announceWrite, emit, auditCreate } = build();
    await bridge.handle('not json');
    await bridge.handle(JSON.stringify({ kind: 'something.else' }));
    expect(announceWrite).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  describe('the audit trail', () => {
    // From a worker that sends the commit author's address.
    const withAddress = JSON.stringify({
      kind: 'tasks.moved_by_commit',
      projectId: 'p1',
      moves: [{ taskId: 't1', from: 'IN_PROGRESS', to: 'REVIEW' }],
      commit: { sha: 'abcdef1234567890', author: 'Dana Dev', authorEmail: '  Dana@Corp.COM ' },
    });

    // A card went to Review and the trail had nothing to say about it.
    it('records the move, credited to the member whose address the commit carries', async () => {
      const { bridge, auditCreate, findUser, findMembership } = build();
      await bridge.handle(withAddress);
      // Matched as sign-in matches an address: trimmed, any case.
      expect(findUser).toHaveBeenCalledWith({ where: { email: 'dana@corp.com' }, select: { id: true } });
      expect(findMembership).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u-dana' } },
        select: { status: true },
      });
      expect(auditCreate).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'w1',
          userId: 'u-dana',
          action: 'task.moved_by_commit',
          entityType: 'task',
          entityId: 't1',
          changes: { status: ['IN_PROGRESS', 'REVIEW'] },
          metadata: {
            label: 'Card form',
            hierarchyId: 'PAY-T-01',
            projectId: 'p1',
            commitSha: 'abcdef1234567890',
            commitAuthor: 'Dana Dev',
          },
        }),
      });
    });

    it('credits nobody when no account has the address, and keeps the name the commit gave', async () => {
      const { bridge, auditCreate, findMembership } = build({ account: null });
      await bridge.handle(withAddress);
      expect(findMembership).not.toHaveBeenCalled();
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          metadata: expect.objectContaining({ commitAuthor: 'Dana Dev', commitSha: 'abcdef1234567890' }),
        }),
      });
    });

    it('credits nobody whose account is not in this workspace, or only invited to it', async () => {
      for (const membership of [null, { status: 'INVITED' }]) {
        const { bridge, auditCreate } = build({ membership });
        await bridge.handle(withAddress);
        expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: null }) });
      }
    });

    it('still credits somebody whose access was switched off since: they wrote the commit', async () => {
      const { bridge, auditCreate } = build({ membership: { status: 'INACTIVE' } });
      await bridge.handle(withAddress);
      expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-dana' }) });
    });

    // A worker older than this sends neither the address nor where the task went.
    it('records a move from an older worker too, under the commit name and as a move to Review', async () => {
      const { bridge, auditCreate, findUser } = build();
      await bridge.handle(moved);
      expect(findUser).not.toHaveBeenCalled();
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
          changes: { status: ['IN_PROGRESS', 'REVIEW'] },
          metadata: expect.objectContaining({ commitAuthor: 'Dana Dev' }),
        }),
      });
    });

    it('a trail that cannot be written does not stop open screens being told', async () => {
      const { bridge, announceWrite, emit } = build({ auditFails: true });
      await expect(bridge.handle(withAddress)).resolves.toBeUndefined();
      expect(emit).toHaveBeenCalledTimes(1);
      expect(announceWrite).toHaveBeenCalledWith('FunctionalRequirement', 'update', { id: 'fr1' });
      expect(announceWrite).toHaveBeenCalledWith('Epic', 'update', { id: 'e1' });
    });
  });
});
