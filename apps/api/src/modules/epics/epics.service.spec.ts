import { EpicsService } from './epics.service';
import type { PrismaService } from '@strata/prisma';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import type { User } from '@prisma/client';

/**
 * The epic rollup derives `status` from a COUNT, never from the rounded
 * percentage.
 *
 * `Math.round(done / total * 100)` reaches 100 while work is still open — at
 * 200 of 201, and at 999 of 1000 — so a client that read DONE off that number
 * sent `{progress: 100, status: 'DONE'}` for an epic every other surface called
 * IN_PROGRESS. The client no longer derives from the percentage, but the
 * invariant is enforced here too: this is the only place that can count the
 * tasks authoritatively.
 *
 * The boundary is impractical to reach through the API (201 task creates is
 * over the write throttle), so it is pinned here.
 */
describe('EpicsService rollup — status is a count, not a rounded percentage', () => {
  const user = { id: 'u1', name: 'U', isAdmin: false } as unknown as User;
  const row = {
    id: 'e1',
    workspaceId: 'w1',
    projectId: 'p1',
    hierarchyId: 'E-1',
    name: 'Epic',
    description: '',
    color: '',
    requirementId: '',
    startDate: null,
    endDate: null,
    status: 'IN_PROGRESS',
    progress: 0,
    assignedTeam: '',
    createdById: 'u1',
    createdByName: 'U',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  /** An epic carrying `total` tasks, `done` of them DONE. */
  function build(total: number, done: number, privileged: boolean) {
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data }));
    const count = jest.fn().mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.status === 'DONE' ? done : total),
    );
    const prisma = {
      epic: { update, findFirst: jest.fn().mockResolvedValue(row) },
      task: { count },
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({}),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      // `can(PlanningWrite)` is what separates a manager from a delivery role.
      can: jest.fn().mockResolvedValue(privileged),
    } as unknown as WorkspaceAccessService;
    return { svc: new EpicsService(prisma, access), update };
  }

  async function written(total: number, done: number, privileged: boolean, submitted = { progress: 0, status: 'TODO' }) {
    const { svc, update } = build(total, done, privileged);
    await svc.patch(user, 'e1', submitted);
    expect(update).toHaveBeenCalled();
    return (update.mock.calls[0][0] as { data: { progress: number; status: string } }).data;
  }

  describe('a delivery role (task:update, no planning:write) — both halves derived', () => {
    it('200 of 201 rounds to 100% and is still IN_PROGRESS', async () => {
      const data = await written(201, 200, false);
      expect(data.progress).toBe(100); // the rounding really does reach 100
      expect(data.status).toBe('IN_PROGRESS'); // ...and the status does not follow it
    });

    it('999 of 1000 rounds to 100% and is still IN_PROGRESS', async () => {
      expect(await written(1000, 999, false)).toMatchObject({ progress: 100, status: 'IN_PROGRESS' });
    });

    it('every task done IS done', async () => {
      expect(await written(201, 201, false)).toMatchObject({ progress: 100, status: 'DONE' });
    });

    it('an epic with no tasks is TODO at 0%, not DONE', async () => {
      // 0 === 0 must not read as "all of them are finished".
      expect(await written(0, 0, false)).toMatchObject({ progress: 0, status: 'TODO' });
    });

    it('nothing started is TODO; partly done is IN_PROGRESS', async () => {
      expect(await written(5, 0, false)).toMatchObject({ progress: 0, status: 'TODO' });
      expect(await written(4, 1, false)).toMatchObject({ progress: 25, status: 'IN_PROGRESS' });
    });

    it('ignores the numbers the caller submitted', async () => {
      // task:update must not be a way to declare an epic finished.
      const data = await written(4, 1, false, { progress: 100, status: 'DONE' });
      expect(data).toMatchObject({ progress: 25, status: 'IN_PROGRESS' });
    });
  });

  describe('a manager (planning:write) — keeps the progress, never the status', () => {
    it('a submitted 100% with a task still open is stored IN_PROGRESS', async () => {
      // This is the exact payload the old client sent for 240 of 241.
      const data = await written(201, 200, true, { progress: 100, status: 'DONE' });
      expect(data.progress).toBe(100); // the measured half is the caller's
      expect(data.status).toBe('IN_PROGRESS'); // the derived half is not
    });

    it('a submitted 100% with every task done stays DONE', async () => {
      expect(await written(9, 9, true, { progress: 100, status: 'DONE' })).toMatchObject({
        progress: 100,
        status: 'DONE',
      });
    });

    it('a status sent ALONE is a human decision and is stored verbatim', async () => {
      // Nothing about a task set means "a person decided this", so a bare
      // status is not treated as a rollup.
      const { svc, update } = build(4, 1, true);
      await svc.patch(user, 'e1', { status: 'DONE' });
      expect((update.mock.calls[0][0] as { data: Record<string, unknown> }).data).toEqual({ status: 'DONE' });
    });
  });
});
