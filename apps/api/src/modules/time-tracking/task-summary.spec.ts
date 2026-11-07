import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TimeEntriesService } from './time-tracking.services';

/**
 * A task's logged time is a fact about the task. The task's time card was built
 * on the personal entry list, so it showed each person their own minutes under
 * "Total Logged" — a developer looking at a task three colleagues had spent a
 * week on read "0m".
 */
describe('TimeEntriesService.taskSummary', () => {
  const me = { id: 'me', name: 'Me' } as User;

  function build(
    entries: Array<{ userId: string; duration: number; isBillable: boolean; status: string }>,
    opts: { task?: { workspaceId: string } | null; member?: boolean } = {},
  ) {
    const findMany = jest.fn().mockResolvedValue(entries);
    const prisma = {
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.task === undefined ? { workspaceId: 'w1' } : opts.task),
      },
      timeEntry: { findMany },
    } as unknown as PrismaService;
    const access = {
      assertMember: jest.fn(() =>
        opts.member === false
          ? Promise.reject(new ForbiddenException('no'))
          : Promise.resolve(undefined),
      ),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
    } as unknown as WorkspaceAccessService;
    return { svc: new TimeEntriesService(prisma, access), findMany, access };
  }

  it('adds up everybody’s time, and says how much of it is the caller’s', async () => {
    const { svc } = build([
      { userId: 'me', duration: 30, isBillable: true, status: 'APPROVED' },
      { userId: 'a', duration: 120, isBillable: true, status: 'PENDING' },
      { userId: 'b', duration: 45, isBillable: false, status: 'APPROVED' },
    ]);
    expect(await svc.taskSummary(me, 't1')).toEqual({
      taskId: 't1',
      totalMinutes: 195,
      billableMinutes: 150,
      approvedMinutes: 75,
      entryCount: 3,
      people: 3,
      mine: { totalMinutes: 30, entryCount: 1 },
    });
  });

  // Nothing personal leaves: the query asks for no description and no rate, and
  // the answer names nobody.
  it('reads only the columns it sums, and leaves refused time out', async () => {
    const { svc, findMany } = build([]);
    const summary = await svc.taskSummary(me, 't1');
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 't1', workspaceId: 'w1', status: { not: 'REJECTED' } },
      select: { userId: true, duration: true, isBillable: true, status: true },
    });
    expect(summary).toMatchObject({ totalMinutes: 0, people: 0, mine: { totalMinutes: 0 } });
  });

  it('is for members of the task’s workspace, and nobody else', async () => {
    const { svc, findMany } = build([], { member: false });
    await expect(svc.taskSummary(me, 't1')).rejects.toThrow(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not answer for a task that does not exist', async () => {
    const { svc } = build([], { task: null });
    await expect(svc.taskSummary(me, 'nope')).rejects.toThrow('Not found.');
  });
});
