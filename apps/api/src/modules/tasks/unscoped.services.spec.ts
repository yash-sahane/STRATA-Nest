import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { KanbanColumnsService, TaskCommentsService } from './unscoped.services';

/**
 * Security regression guard: TaskComment and KanbanColumn are scoped through
 * their parent (Task / Project). A caller who is not a member of the parent's
 * workspace must not be able to read, edit, or delete a record by id.
 */
describe('unscoped.services — parent-workspace membership scoping', () => {
  const member = { id: 'u-member' } as User;
  const outsider = { id: 'u-outsider' } as User;

  function accessMock(memberIds: string[]): WorkspaceAccessService {
    return {
      isPlatformAdmin: () => false,
      activeMembership: (userId: string) =>
        Promise.resolve(memberIds.includes(userId) ? ({ id: 'm' } as unknown) : null),
    } as unknown as WorkspaceAccessService;
  }

  describe('TaskCommentsService', () => {
    const comment = { id: 'c1', taskId: 't1', userId: 'u-member', content: 'hi', mentions: [], attachments: [], createdAt: new Date(), updatedAt: new Date() };
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
        task: { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws1' }) },
        // The service runs the findMany/count pair in one transaction.
        $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      } as unknown as PrismaService;
      return { svc: new TaskCommentsService(prisma, accessMock(memberIds)), prisma };
    }

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
  });

  describe('KanbanColumnsService', () => {
    const col = { id: 'k1', projectId: 'p1', name: 'Todo', status: 'TODO', wipLimit: null, position: 0, color: '', createdAt: new Date(), updatedAt: new Date() };
    function make(memberIds: string[]) {
      const prisma = {
        kanbanColumn: {
          findUnique: jest.fn().mockResolvedValue(col),
          update: jest.fn().mockResolvedValue(col),
          delete: jest.fn().mockResolvedValue(col),
        },
        project: { findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws1' }) },
      } as unknown as PrismaService;
      return { svc: new KanbanColumnsService(prisma, accessMock(memberIds)), prisma };
    }

    it('member can retrieve', async () => {
      const { svc } = make(['u-member']);
      await expect(svc.retrieve(member, 'k1')).resolves.toMatchObject({ id: 'k1' });
    });
    it('outsider gets 404 on retrieve and cannot update', async () => {
      const { svc, prisma } = make(['u-member']);
      await expect(svc.retrieve(outsider, 'k1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.update(outsider, 'k1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      expect((prisma as unknown as { kanbanColumn: { update: jest.Mock } }).kanbanColumn.update).not.toHaveBeenCalled();
    });
  });
});
