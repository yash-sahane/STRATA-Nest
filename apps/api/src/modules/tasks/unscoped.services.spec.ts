import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TaskCommentsService } from './unscoped.services';

/**
 * Security regression guard: a TaskComment is scoped through its parent Task.
 * A caller who is not a member of the task's workspace must not be able to read,
 * edit, or delete a comment by id.
 */
describe('unscoped.services — parent-workspace membership scoping', () => {
  const member = { id: 'u-member' } as User;
  const outsider = { id: 'u-outsider' } as User;

  function accessMock(memberIds: string[], writerIds: string[] = memberIds): WorkspaceAccessService {
    return {
      isPlatformAdmin: () => false,
      activeMembership: (userId: string) =>
        Promise.resolve(memberIds.includes(userId) ? ({ id: 'm' } as unknown) : null),
      assertPermission: (user: User) =>
        writerIds.includes(user.id)
          ? Promise.resolve()
          : Promise.reject(new ForbiddenException('denied')),
      can: (user: User) => Promise.resolve(writerIds.includes(user.id)),
    } as unknown as WorkspaceAccessService;
  }

  describe('TaskCommentsService', () => {
    const comment = { id: 'c1', taskId: 't1', userId: 'u-member', content: 'hi', mentions: [], createdAt: new Date(), updatedAt: new Date() };
    function make(memberIds: string[]) {
      const prisma = {
        taskComment: {
          findUnique: jest.fn().mockResolvedValue(comment),
          update: jest.fn().mockResolvedValue(comment),
          delete: jest.fn().mockResolvedValue(comment),
          // The list path needs these; without them the taskId tests below fail
          // on a missing mock rather than on the behaviour under test.
          findMany: jest.fn().mockResolvedValue([comment]),
          count: jest.fn().mockResolvedValue(1),
        },
        task: {
          findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws1', projectId: 'p1', title: 'Fix login', hierarchyId: 'P-T01' }),
        },
        // The service runs the findMany/count pair in one transaction.
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      } as unknown as PrismaService;
      return { svc: new TaskCommentsService(prisma, accessMock(memberIds)), prisma };
    }
    /** Members u-member (the author) and u-other; u-lead may delete tasks. */
    function moderated() {
      const prisma = {
        taskComment: {
          findUnique: jest.fn().mockResolvedValue(comment),
          update: jest.fn().mockResolvedValue(comment),
          delete: jest.fn().mockResolvedValue(comment),
        },
        task: {
          findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws1', projectId: 'p1', title: 'Fix login', hierarchyId: 'P-T01' }),
        },
      } as unknown as PrismaService;
      const emit = jest.fn();
      const access = accessMock(['u-member', 'u-other', 'u-lead'], ['u-lead']);
      const svc = new TaskCommentsService(prisma, access, { emit } as never);
      return { svc, prisma, emit, del: (prisma as unknown as { taskComment: { delete: jest.Mock } }).taskComment.delete };
    }
    const lead = { id: 'u-lead', name: 'Lead' } as User;
    const other = { id: 'u-other' } as User;

    it('whoever may delete tasks removes somebody else\'s comment, and its author is told', async () => {
      const { svc, del, emit } = moderated();
      await svc.remove(lead, 'c1');
      expect(del).toHaveBeenCalledWith({ where: { id: 'c1' } });
      const notice = emit.mock.calls.map((call) => call[1]?.payload ?? call[1]).find((p) => p?.type === 'TASK_COMMENT_REMOVED');
      expect(notice).toMatchObject({ recipients: ['u-member'], actorId: 'u-lead' });
    });
    it('another member may not', async () => {
      const { svc, del } = moderated();
      await expect(svc.remove(other, 'c1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(del).not.toHaveBeenCalled();
    });
    it('and nobody but its author may edit it', async () => {
      const { svc } = moderated();
      await expect(svc.update(lead, 'c1', { content: 'rewritten' })).rejects.toBeInstanceOf(ForbiddenException);
    });
    // Not even a platform admin: an edit puts words under somebody else's name.
    // They may take a comment down (remove), and its author is told who did.
    it('not even a platform admin', async () => {
      const { prisma } = moderated();
      const admin = { id: 'u-admin' } as User;
      const access = {
        ...accessMock([]),
        isPlatformAdmin: (who: User) => who.id === 'u-admin',
      } as unknown as WorkspaceAccessService;
      const svc = new TaskCommentsService(prisma, access, { emit: jest.fn() } as never);
      await expect(svc.update(admin, 'c1', { content: 'rewritten' })).rejects.toBeInstanceOf(ForbiddenException);
      const { update } = (prisma as unknown as { taskComment: { update: jest.Mock } }).taskComment;
      expect(update).not.toHaveBeenCalled();
    });
    it('its author still edits it', async () => {
      const { svc, prisma } = moderated();
      await svc.update(member, 'c1', { content: 'fixed a typo' });
      const { update } = (prisma as unknown as { taskComment: { update: jest.Mock } }).taskComment;
      expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { content: 'fixed a typo' } });
    });
    it('its author deletes it without a notice to themselves', async () => {
      const { svc, del, emit } = moderated();
      await svc.remove(member, 'c1');
      expect(del).toHaveBeenCalled();
      expect(emit.mock.calls.some((call) => (call[1]?.payload ?? call[1])?.type === 'TASK_COMMENT_REMOVED')).toBe(false);
    });

    it('member of the task workspace can retrieve', async () => {
      const { svc } = make(['u-member']);
      await expect(svc.retrieve(member, 'c1')).resolves.toMatchObject({ id: 'c1' });
    });
    it('outsider gets 404 on retrieve', async () => {
      const { svc } = make(['u-member']);
      await expect(svc.retrieve(outsider, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('outsider cannot delete', async () => {
      const { svc, prisma } = make(['u-member']);
      await expect(svc.remove(outsider, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma as unknown as { taskComment: { delete: jest.Mock } }).taskComment.delete).not.toHaveBeenCalled();
    });
    it('list requires a taskId and membership', async () => {
      const { svc } = make(['u-member']);
      // A missing taskId is a BAD REQUEST, not a 404. This assertion used to pin
      // NotFoundException, which sent a caller who had simply omitted a parameter
      // looking for a record that had been deleted.
      await expect(svc.list(member, {})).rejects.toBeInstanceOf(BadRequestException);
      // Unchanged, and the point of this suite: a non-member is told the task does
      // not exist rather than that they may not see it.
      await expect(svc.list(outsider, { taskId: 't1' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a REPEATED taskId is still one task, not a missing one', async () => {
      // Express parses ?taskId=t1&taskId=t1 into an array, and the old
      // `typeof query.taskId === 'string'` test read that as absent — so a
      // duplicated link answered 404 "Not found." for a task that exists and the
      // caller had named. Measured against the live API before the fix:
      // one param -> 200, the same param twice -> 404.
      const { svc } = make(['u-member']);
      await expect(svc.list(member, { taskId: ['t1', 't1'] })).resolves.toMatchObject({
        items: expect.any(Array),
      });
    });

    it('but two DIFFERENT taskIds are refused rather than silently narrowed', async () => {
      // The membership check downstream is against ONE id, so picking the first
      // would authorise against one task and filter by another.
      const { svc } = make(['u-member']);
      await expect(svc.list(member, { taskId: ['t1', 't2'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('a suffixed taskId cannot widen the list past the authorised task', async () => {
      // `?taskId=t1&taskId__ne=x` was authorised against t1 and then filtered by
      // `{ not: 'x' }` alone — every comment in every tenant, since this model
      // has no workspace column to fall back on.
      const { svc, prisma } = make(['u-member']);
      await svc.list(member, { taskId: 't1', taskId__ne: 'x' });
      const { findMany } = (prisma as unknown as { taskComment: { findMany: jest.Mock } }).taskComment;
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ taskId: 't1' }, { taskId: 't1' }] } }),
      );
    });
  });
});
