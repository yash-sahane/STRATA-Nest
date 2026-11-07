import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '@strata/prisma';
import { Prisma, type Sprint, type User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { SprintsService } from './sprints.services';

const user = { id: 'u1', name: 'U' } as User;

const stored = {
  id: 's1',
  workspaceId: 'w1',
  projectId: 'p1',
  name: 'S',
  goal: '',
  startDate: new Date('2026-08-11T00:00:00.000Z'),
  endDate: new Date('2026-08-20T00:00:00.000Z'),
  status: 'PLANNING',
  retrospectiveNotes: '',
  createdById: 'u1',
  createdByName: 'U',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} as Sprint;

function build(
  opts: {
    /** The stored sprint's status; PLANNING unless a case says otherwise. */
    status?: string;
    /** Another sprint of the same project that is already ACTIVE. */
    activeClash?: { name: string } | null;
  } = {},
) {
  const row = { ...stored, status: opts.status ?? stored.status } as Sprint;
  const create = jest.fn().mockResolvedValue(row);
  const update = jest.fn().mockResolvedValue(row);
  // The project lookup backs the cross-workspace guard every create runs now.
  const project = {
    findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }),
    // A sprint starting moves a project still in Planning to Active.
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  // Two different questions reach findFirst: the scoped read of THIS sprint, and
  // the "is another one already active?" probe, which is the one that selects.
  const findFirst = jest.fn((args: { select?: unknown }) =>
    Promise.resolve(args?.select ? (opts.activeClash ?? null) : row),
  );
  // A start is one conditional write: it moves the sprint only while it is not
  // already running (count 1), and a second ACTIVE sprint in the project is
  // refused by the database's partial unique index.
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue({ ...row, status: 'ACTIVE' });
  // Nothing about a start may take a transaction any more (see SprintsService.start).
  const $transaction = jest.fn();
  const announceWrite = jest.fn();
  const prisma = {
    sprint: { create, update, findFirst, updateMany, findUniqueOrThrow },
    project,
    $transaction,
    announceWrite,
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({}),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(true),
  } as unknown as WorkspaceAccessService;
  const events = new EventEmitter2();
  return {
    svc: new SprintsService(prisma, access, events),
    create,
    update,
    project,
    findFirst,
    updateMany,
    findUniqueOrThrow,
    announceWrite,
    $transaction,
    events,
  };
}

const base = { workspaceId: 'w1', projectId: 'p1', name: 'Sprint 1' };

describe('SprintsService date handling', () => {
  it('stores a date-only startDate on that exact calendar day', async () => {
    const { svc, create } = build();
    await svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-20' });
    const data = create.mock.calls[0][0].data as { startDate: Date; endDate: Date };
    expect(data.startDate.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(data.endDate.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('accepts a one-day sprint (start === end)', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-11' }),
    ).resolves.toBeDefined();
    expect(create).toHaveBeenCalled();
  });

  // create() is async now — it verifies the project belongs to the declared
  // workspace before writing — so these are rejections, not synchronous throws.
  it('rejects an end date before the start date', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-20', endDate: '2026-08-11' }),
    ).rejects.toThrow('endDate must be on or after startDate');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unparseable date instead of handing Prisma an Invalid Date', async () => {
    const { svc, create } = build();
    await expect(
      svc.create(user, { ...base, startDate: 'garbage', endDate: '2026-08-20' }),
    ).rejects.toThrow('startDate must be a valid ISO date');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a project that belongs to a different workspace', async () => {
    const { svc, create, project } = build();
    project.findUnique.mockResolvedValueOnce({ workspaceId: 'someone-else' });
    await expect(
      svc.create(user, { ...base, startDate: '2026-08-11', endDate: '2026-08-20' }),
    ).rejects.toThrow(/different workspace|does not belong/i);
    expect(create).not.toHaveBeenCalled();
  });

  // patch() is async now: it reads the stored sprint so a one-sided edit can be
  // validated against the range it actually produces.
  it('rejects an inverted range on patch when both dates are supplied', async () => {
    const { svc, update } = build();
    await expect(
      svc.patch(user, 's1', { startDate: '2026-08-20', endDate: '2026-08-11' }),
    ).rejects.toThrow('endDate must be on or after startDate');
    expect(update).not.toHaveBeenCalled();
  });

  // The stored sprint runs 2026-08-11 → 2026-08-20.
  it('rejects an endDate-only patch that lands before the STORED startDate', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { endDate: '2026-07-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a startDate-only patch that lands after the STORED endDate', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { startDate: '2026-09-01' })).rejects.toThrow(
      'endDate must be on or after startDate',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('allows a one-sided patch that keeps the merged range ordered', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { endDate: '2026-08-25' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('does not read the sprint for a patch that touches no date', async () => {
    const { svc, update } = build();
    await expect(svc.patch(user, 's1', { name: 'Renamed' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });
});

describe('SprintsService.create — a sprint starts life in Planning', () => {
  const dates = { startDate: '2026-08-11', endDate: '2026-08-20' };

  it('creates it in Planning, said or not', async () => {
    const { svc, create } = build();
    await svc.create(user, { ...base, ...dates });
    await svc.create(user, { ...base, ...dates, status: 'PLANNING' });
    expect(create.mock.calls.map(([args]) => args.data.status)).toEqual(['PLANNING', 'PLANNING']);
  });

  // Created ACTIVE it skipped the start — its lock, its tasks moving onto the
  // board, the announcement — and two could race into existence side by side.
  it('refuses to create one already running, or already closed', async () => {
    const { svc, create } = build();
    for (const status of ['ACTIVE', 'COMPLETED']) {
      await expect(svc.create(user, { ...base, ...dates, status })).rejects.toThrow(
        'A sprint is created in Planning. Create it, then start it from the sprint page.',
      );
    }
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SprintsService status changes through PATCH', () => {
  it('starts a planned sprint when no other is running', async () => {
    const { svc, updateMany, announceWrite } = build();
    await expect(svc.patch(user, 's1', { status: 'ACTIVE' })).resolves.toBeDefined();
    expect(updateMany).toHaveBeenCalled();
    // The flip is an updateMany, which the realtime hook does not see.
    expect(announceWrite).toHaveBeenCalledWith('Sprint', 'update', expect.objectContaining({ status: 'ACTIVE' }));
  });

  it('makes a project still in Planning Active when its sprint starts, and no other', async () => {
    const { svc, project } = build();
    await svc.patch(user, 's1', { status: 'ACTIVE' });
    expect(project.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'PLANNING' },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });
  });

  // A completed sprint is a record: what it was run against stays as it was.
  it('lets a completed sprint be renamed and its retrospective written', async () => {
    const { svc, update } = build({ status: 'COMPLETED' });
    await expect(svc.patch(user, 's1', { name: 'Sprint 1 — Checkout' })).resolves.toBeDefined();
    await expect(svc.patch(user, 's1', { retrospectiveNotes: 'Went well' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("refuses to change a completed sprint's goal or dates", async () => {
    const { svc, update } = build({ status: 'COMPLETED' });
    await expect(svc.patch(user, 's1', { goal: 'Something else' })).rejects.toThrow(/its record/);
    await expect(svc.patch(user, 's1', { endDate: '2026-12-01' })).rejects.toThrow(/its record/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to start a second sprint beside the one already active', async () => {
    const { svc, update } = build({ activeClash: { name: 'Sprint 7' } });
    await expect(svc.patch(user, 's1', { status: 'ACTIVE' })).rejects.toThrow(
      '"Sprint 7" is already the active sprint for this project. Complete it first.',
    );
    expect(update).not.toHaveBeenCalled();
  });

  // Checked before the write, two starts at once each saw nothing running and
  // both went ACTIVE. An advisory lock fixed that at the cost of two pooled
  // connections per start; the rule is the database's now.
  it('starts with one conditional write — no transaction, no lock — that moves only a sprint not yet running', async () => {
    const { svc, updateMany, $transaction } = build();
    await svc.patch(user, 's1', { status: 'ACTIVE' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: { notIn: ['ACTIVE', 'COMPLETED'] } },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('a start that loses to another sprint of the project is refused as the check refuses it', async () => {
    const { svc, updateMany, findFirst, events } = build();
    const emitted = jest.spyOn(events, 'emitAsync');
    // Nothing running when it looked; the other start committed first, and the
    // one-active index refuses this write.
    updateMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    let probes = 0;
    findFirst.mockImplementation((args: { select?: unknown }) => {
      if (!args?.select) return Promise.resolve({ ...stored });
      probes += 1;
      return Promise.resolve(probes > 2 ? { name: 'Sprint 8' } : null);
    });
    await expect(svc.patch(user, 's1', { status: 'ACTIVE' })).rejects.toThrow(
      '"Sprint 8" is already the active sprint for this project. Complete it first.',
    );
    expect(emitted).not.toHaveBeenCalled();
  });

  it('announces a start once, when two requests start the same sprint', async () => {
    const { svc, project, updateMany, events } = build();
    const emitted = jest.spyOn(events, 'emitAsync');
    // PLANNING when this request read it; the other request's start moved it
    // first, so this write matches nothing.
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.patch(user, 's1', { status: 'ACTIVE' })).resolves.toBeDefined();
    expect(emitted).not.toHaveBeenCalled();
    expect(project.updateMany).not.toHaveBeenCalled();
  });

  it('saves the rest of a starting patch without writing the status again', async () => {
    const { svc, update } = build();
    await svc.patch(user, 's1', { status: 'ACTIVE', name: 'Sprint 1 — Checkout' });
    // A sprint completed in the same moment must not be set running again.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }),
    );
  });

  it('takes no transaction for an edit that starts nothing', async () => {
    const { svc, $transaction, updateMany } = build({ status: 'ACTIVE' });
    await svc.patch(user, 's1', { name: 'Renamed', status: 'ACTIVE' });
    expect($transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not close a sprint: that is what POST /complete is for', async () => {
    const { svc, update } = build({ status: 'ACTIVE' });
    await expect(svc.patch(user, 's1', { status: 'COMPLETED' })).rejects.toThrow(
      'Use "Complete Sprint" to close a sprint',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not reopen a completed sprint', async () => {
    const { svc, update } = build({ status: 'COMPLETED' });
    for (const status of ['ACTIVE', 'PLANNING']) {
      await expect(svc.patch(user, 's1', { status })).rejects.toThrow(
        'A completed sprint cannot be reopened.',
      );
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('lets a completed sprint be renamed, and its notes written', async () => {
    const { svc, update } = build({ status: 'COMPLETED' });
    await expect(
      svc.patch(user, 's1', { name: 'Sprint 1 (final)', retrospectiveNotes: 'went fine' }),
    ).resolves.toBeDefined();
    // Re-sending the status it already has is not a transition.
    await expect(svc.patch(user, 's1', { status: 'COMPLETED' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledTimes(2);
  });
});
