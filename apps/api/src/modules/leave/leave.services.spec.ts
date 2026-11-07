import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { Permission } from '../authz/permissions';
import { LeaveBalancesService, LeaveRequestsService } from './leave.services';

const ROW = {
  id: 'lr1',
  createdAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  workspaceId: 'w1',
  userId: 'u1',
  createdById: 'u1',
  createdByName: '',
  type: 'CASUAL',
  startDate: new Date('2026-08-03'),
  endDate: new Date('2026-08-03'),
  reason: 'family',
  status: 'PENDING',
  approvedBy: '',
  approvedAt: null,
  rejectionReason: '',
  daysCount: 1,
};

const BALANCE = { id: 'b1', paidLeave: 21, unpaidLeave: 0, halfDay: 12, compOff: 0 };

// When leave may START is a rule now, so "today" is part of every case. The
// dates below are August 2026; the clock is set just before them. Only the
// clock is faked — the service is all promises.
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-07-20T06:00:00.000Z'),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
});
afterAll(() => jest.useRealTimers());

function build(
  opts: {
    row?: Record<string, unknown>;
    clash?: { id: string } | null;
    open?: Array<{ type: string; daysCount: number; startDate: Date }>;
    balance?: typeof BALANCE;
    canApprove?: boolean;
    holidays?: Array<{ date: Date }>;
    /** Rows an edit's conditional write matches: 0 once the request was decided. */
    editable?: number;
  } = {},
) {
  // The insert under the submission lock: `createManyAndReturn`, which the
  // realtime write hook does not see, so the frame can wait for the commit.
  const create = jest.fn(({ data }: { data: Array<Record<string, unknown>> }) =>
    Promise.resolve(data.map((d) => ({ ...ROW, ...d }))),
  );
  const update = jest.fn().mockResolvedValue(ROW);
  const updateMany = jest.fn().mockResolvedValue({ count: opts.editable ?? 1 });
  const remove = jest.fn().mockResolvedValue(undefined);
  const findMany = jest.fn().mockResolvedValue(opts.open ?? []);
  const prisma = {
    leaveRequest: {
      // `select` is only set by the overlap probe; findScoped asks for the row.
      findFirst: jest.fn((args: { select?: unknown }) =>
        Promise.resolve(args.select ? (opts.clash ?? null) : (opts.row ?? ROW)),
      ),
      findMany,
      count: jest.fn().mockResolvedValue(0),
      createManyAndReturn: create,
      update,
      updateMany,
      findUniqueOrThrow: jest.fn().mockResolvedValue(opts.row ?? ROW),
      delete: remove,
    },
    leaveBalance: { upsert: jest.fn().mockResolvedValue(opts.balance ?? BALANCE) },
    // Public holidays are excluded from the day count, so resolveRange loads them.
    holiday: { findMany: jest.fn().mockResolvedValue(opts.holidays ?? []) },
    // ...and the office's own day, which decides whether the leave starts in the past.
    workspace: { findUnique: jest.fn().mockResolvedValue({ settings: { timezone: 'UTC' } }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    // `create` runs its overlap + affordability checks under a transaction-scoped
    // advisory lock, so concurrent submissions from one member queue up rather
    // than both passing a check-then-act race. Everything under the lock runs
    // on the transaction, so the mock hands the same delegates to the callback.
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      Promise.resolve(
        fn({
          $executeRaw: jest.fn().mockResolvedValue(1),
          leaveRequest: prisma.leaveRequest,
          leaveBalance: prisma.leaveBalance,
        }),
      ),
    ),
    announceWrite: jest.fn(),
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(opts.canApprove ?? false),
    membersHolding: jest.fn().mockResolvedValue(['mgr']),
  } as unknown as WorkspaceAccessService;
  const emit = jest.fn();
  return {
    prisma,
    access,
    svc: new LeaveRequestsService(prisma, access, { emit } as never),
    create,
    update,
    updateMany,
    findMany,
    remove,
    emit,
  };
}

const user = { id: 'u1', name: 'Member' } as User;
const dto = {
  workspaceId: 'w1',
  type: 'CASUAL',
  startDate: '2026-08-03',
  endDate: '2026-08-03',
  reason: 'family matters',
};

describe('LeaveRequestsService.create', () => {
  it('derives daysCount from the range instead of trusting the client', async () => {
    const { svc, create } = build();
    // 2026-08-01 is a week-1 Saturday — a working day under the alternate-
    // Saturday rule attendance uses — so the range is 1 working day.
    await svc.create(user, { ...dto, startDate: '2026-08-01', endDate: '2026-08-01' });
    expect(create).toHaveBeenCalledWith({
      data: [expect.objectContaining({ daysCount: 1, userId: 'u1', status: 'PENDING' })],
    });
  });

  it('rejects a range that contains no working days', async () => {
    const { svc } = build();
    // 2026-08-08 is a week-2 Saturday, 2026-08-09 a Sunday.
    await expect(
      svc.create(user, { ...dto, startDate: '2026-08-08', endDate: '2026-08-09' }),
    ).rejects.toThrow(/no working days/i);
  });

  it('rejects an end date before the start date', async () => {
    const { svc } = build();
    await expect(
      svc.create(user, { ...dto, startDate: '2026-08-05', endDate: '2026-08-03' }),
    ).rejects.toThrow(/before the start date/i);
  });

  it('does not charge the balance for a public holiday inside the range', async () => {
    // Mon 2026-08-03 → Wed 2026-08-05 is 3 working days; the 4th is a holiday.
    const { svc, create } = build({ holidays: [{ date: new Date('2026-08-04T00:00:00.000Z') }] });
    await svc.create(user, { ...dto, startDate: '2026-08-03', endDate: '2026-08-05' });
    expect(create).toHaveBeenCalledWith({ data: [expect.objectContaining({ daysCount: 2 })] });
  });

  it('rejects a range made entirely of public holidays', async () => {
    const { svc } = build({ holidays: [{ date: new Date('2026-08-03T00:00:00.000Z') }] });
    await expect(
      svc.create(user, { ...dto, startDate: '2026-08-03', endDate: '2026-08-03' }),
    ).rejects.toThrow(/no working days/i);
  });

  it('rejects a multi-day HALF_DAY request', async () => {
    const { svc } = build();
    await expect(
      svc.create(user, { ...dto, type: 'HALF_DAY', startDate: '2026-08-03', endDate: '2026-08-07' }),
    ).rejects.toThrow(/same day/i);
  });

  it('rejects dates already covered by another open request', async () => {
    const { svc } = build({ clash: { id: 'lr9' } });
    await expect(svc.create(user, dto)).rejects.toThrow(/already have a leave request/i);
  });

  it('counts other PENDING requests against the balance before accepting', async () => {
    const { svc } = build({
      balance: { ...BALANCE, paidLeave: 2 },
      open: [{ type: 'CASUAL', daysCount: 2, startDate: new Date('2026-09-01') }],
    });
    await expect(svc.create(user, dto)).rejects.toThrow(/insufficient leave balance/i);
  });
});

describe('LeaveRequestsService.create — the approvers are told', () => {
  it('announces the request once it is saved, with the server’s own day count', async () => {
    const { svc, emit, create, prisma } = build();
    await svc.create(user, dto);
    // The row the insert wrote, by the id it was given.
    const insertedId = (create.mock.calls[0][0] as { data: Array<{ id: string }> }).data[0].id;
    expect(insertedId).toEqual(expect.any(String));
    // Its realtime frame goes out after the commit, not from inside the lock.
    expect(prisma.announceWrite).toHaveBeenCalledWith(
      'LeaveRequest',
      'create',
      expect.objectContaining({ id: insertedId }),
    );
    expect(emit).toHaveBeenCalledWith(
      'leave.requested',
      expect.objectContaining({
        workspaceId: 'w1',
        payload: expect.objectContaining({
          workspaceId: 'w1',
          userId: 'u1',
          leaveRequestId: insertedId,
          type: 'CASUAL',
          daysCount: 1,
          requesterName: 'Member',
        }),
      }),
    );
  });

  it('announces nothing for a request that was refused', async () => {
    const { svc, emit } = build({ clash: { id: 'other' } });
    await expect(svc.create(user, dto)).rejects.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('LeaveRequestsService write guards', () => {
  it('refuses to edit a request that has already been decided', async () => {
    const { svc } = build({ row: { ...ROW, status: 'APPROVED' } });
    await expect(svc.patch(user, 'lr1', { reason: 'changed my mind' })).rejects.toThrow(
      /only a pending leave request/i,
    );
  });

  it('refuses to delete an approved request (the units would be stranded)', async () => {
    const { svc, remove } = build({ row: { ...ROW, status: 'APPROVED' } });
    await expect(svc.remove(user, 'lr1')).rejects.toThrow(/cancel an approved leave/i);
    expect(remove).not.toHaveBeenCalled();
  });

  it('blocks a member from editing a colleague’s request', async () => {
    const { svc } = build({ row: { ...ROW, userId: 'u2' } });
    await expect(svc.patch(user, 'lr1', { reason: 'not mine' })).rejects.toThrow(
      /Only the person who asked for this leave/,
    );
  });

  // An approver approves or rejects — which tells the requester. Rewriting the
  // request, or deleting it, told them nothing.
  it('blocks an approver from rewriting or deleting somebody else’s request', async () => {
    const { svc } = build({ row: { ...ROW, userId: 'u2' }, canApprove: true });
    await expect(svc.patch(user, 'lr1', { reason: 'rewritten' })).rejects.toThrow(
      /An approver approves or rejects it/,
    );
    await expect(svc.remove(user, 'lr1')).rejects.toThrow(/An approver approves or rejects it/);
  });

  it('a reason-only edit does not re-run the balance/overlap checks', async () => {
    // Re-validating unconditionally meant fixing a typo could 400 with
    // "Insufficient leave balance" — the balance had legitimately moved since
    // the request was filed — and silently rewrote `daysCount` on legacy rows,
    // changing what approval would deduct. Nothing about the dates changed.
    const { svc, updateMany } = build({ balance: { ...BALANCE, paidLeave: 0 } });
    await expect(svc.patch(user, 'lr1', { reason: 'typo fixed' })).resolves.toBeDefined();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'lr1', status: 'PENDING' },
      data: { reason: 'typo fixed' },
    });
  });

  // The status was read on an earlier statement, so an edit could land after
  // an approval: approved for 1 day, on record as APPROVED for 5, 1 debited.
  it('an edit is written only while the request is still pending', async () => {
    const { svc, updateMany } = build({ editable: 0 });
    await expect(
      svc.patch(user, 'lr1', { startDate: '2026-08-03', endDate: '2026-08-07' }),
    ).rejects.toThrow(/while you were editing/);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'lr1', status: 'PENDING' });
  });

  it('a date edit still re-runs them', async () => {
    const { svc } = build({ balance: { ...BALANCE, paidLeave: 0 } });
    // Current year, because the request paths now share `mine()`'s year window.
    // A five-day span always contains at least one working day.
    const y = new Date().getUTCFullYear();
    await expect(
      svc.patch(user, 'lr1', { startDate: `${y}-08-10`, endDate: `${y}-08-14` }),
    ).rejects.toThrow(/insufficient leave balance/i);
  });

  it('refuses a request booked for a year outside the balance window', async () => {
    // `ensureLeaveBalance` provisions a full default allocation on first touch,
    // so validating a far-future request used to MINT a fresh 21-day pot that
    // approve would then debit.
    const { svc } = build();
    const far = new Date().getUTCFullYear() + 5;
    await expect(
      svc.patch(user, 'lr1', { startDate: `${far}-08-10`, endDate: `${far}-08-14` }),
    ).rejects.toThrow(/out of range/i);
  });
});

describe('LeaveRequestsService.list visibility', () => {
  it('narrows a non-approver to their own rows', async () => {
    const { svc, findMany } = build({ canApprove: false });
    await svc.list(user, { workspaceId: 'w1' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { workspaceId: 'w1', userId: 'u1' }] },
      }),
    );
  });

  it('drops a caller-supplied userId predicate that would widen the scope', async () => {
    const { svc, findMany } = build({ canApprove: false });
    // `userId` first, then the suffixed form: parseListQuery merges both onto
    // where.userId last-one-wins, so leaving `userId__ne` in place turned the
    // forced equality into "everyone but nobody" — the whole workspace.
    await svc.list(user, { workspaceId: 'w1', userId: 'u9', userId__ne: 'nobody' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { workspaceId: 'w1', userId: 'u1' }] },
      }),
    );
  });

  it('lets an approver read the whole workspace', async () => {
    const { svc, findMany } = build({ canApprove: true });
    await svc.list(user, { workspaceId: 'w1' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { workspaceId: 'w1' }] },
      }),
    );
    expect(svc['access'].can).toHaveBeenCalledWith(user, 'w1', Permission.LeaveApprove);
  });

  it('keeps an approver inside the workspace they were checked against', async () => {
    const { svc, findMany } = build({ canApprove: true });
    // Approver in w1, plain member of w2: the suffixed key must not carry the
    // wide read across.
    await svc.list(user, { workspaceId: 'w1', workspaceId__in: 'w2' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ workspaceId: { in: ['w1'] } }, { workspaceId: 'w1' }] },
      }),
    );
  });
});

describe('LeaveBalancesService.mine', () => {
  function buildBalances() {
    const upsert = jest.fn().mockResolvedValue({
      ...BALANCE,
      workspaceId: 'w1',
      userId: 'u1',
      year: new Date().getUTCFullYear(),
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    const prisma = { leaveBalance: { upsert } } as unknown as PrismaService;
    const access = {
      assertMember: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceAccessService;
    return { svc: new LeaveBalancesService(prisma, access), upsert, access };
  }

  it('provisions the caller’s own row — members cannot POST a balance', async () => {
    const { svc, upsert, access } = buildBalances();
    const year = new Date().getUTCFullYear();
    const balance = await svc.mine(user, 'w1');
    expect(access.assertMember).toHaveBeenCalledWith(user, 'w1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId_year: { workspaceId: 'w1', userId: 'u1', year } },
      }),
    );
    expect(balance.paidLeave).toBe(21);
  });

  it('rejects a year outside the current one and its neighbours', async () => {
    const { svc } = buildBalances();
    await expect(svc.mine(user, 'w1', 1990)).rejects.toThrow(/year must be/i);
  });
});

describe('LeaveBalancesService.retrieve is owner-scoped', () => {
  function buildRetrieve(opts: { rowUserId: string; canApprove?: boolean }) {
    const prisma = {
      leaveBalance: {
        findFirst: jest.fn().mockResolvedValue({
          ...BALANCE,
          workspaceId: 'w1',
          userId: opts.rowUserId,
          year: 2026,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      },
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      can: jest.fn().mockResolvedValue(opts.canApprove ?? false),
    } as unknown as WorkspaceAccessService;
    return { svc: new LeaveBalancesService(prisma, access), access };
  }

  it('refuses a colleague’s balance to a member without leave:approve', async () => {
    const { svc } = buildRetrieve({ rowUserId: 'u2' });
    await expect(svc.retrieve(user, 'b1')).rejects.toThrow(
      'You do not have permission to perform this action.',
    );
  });

  it('allows the owner, and an approver', async () => {
    await expect(buildRetrieve({ rowUserId: 'u1' }).svc.retrieve(user, 'b1')).resolves.toEqual(
      expect.objectContaining({ userId: 'u1' }),
    );
    const approver = buildRetrieve({ rowUserId: 'u2', canApprove: true });
    await expect(approver.svc.retrieve(user, 'b1')).resolves.toEqual(
      expect.objectContaining({ userId: 'u2' }),
    );
    expect(approver.access.can).toHaveBeenCalledWith(user, 'w1', Permission.LeaveApprove);
  });
});

describe('LeaveBalancesService — the approver’s allocation screen', () => {
  const YEAR = new Date().getUTCFullYear();

  function buildTeam(
    opts: {
      isMember?: boolean;
      platformAdmin?: boolean;
      approvers?: string[];
      /** The member's row as it stands now, when something has moved it. */
      stored?: Record<string, unknown>;
    } = {},
  ) {
    const stamp = { createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
    // ensureLeaveBalance upserts; the row it hands back is whatever was asked for.
    const upsert = jest.fn().mockImplementation(({ where }) => ({
      ...BALANCE,
      ...stamp,
      id: `bal-${where.workspaceId_userId_year.userId}`,
      workspaceId: 'w1',
      userId: where.workspaceId_userId_year.userId,
      year: where.workspaceId_userId_year.year,
    }));
    // The row as stored. The adjustment writes conditionally on the figures the
    // approver saw, so the mock matches only while every column it names still
    // holds that value — `UPDATE ... WHERE paid_leave = $1` in Postgres.
    const stored: Record<string, unknown> = {
      ...BALANCE,
      ...stamp,
      id: 'bal-u2',
      workspaceId: 'w1',
      userId: 'u2',
      year: YEAR,
      ...(opts.stored ?? {}),
    };
    const update = jest.fn();
    const updateMany = jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (Object.entries(where).some(([key, value]) => key !== 'id' && stored[key] !== value)) {
          return { count: 0 };
        }
        Object.assign(stored, data);
        return { count: 1 };
      },
    );
    const prisma = {
      leaveBalance: {
        upsert,
        update,
        updateMany,
        findUniqueOrThrow: jest.fn(async () => ({ ...stored })),
        findFirst: jest.fn().mockResolvedValue({
          ...BALANCE,
          ...stamp,
          id: 'bal-u2',
          workspaceId: 'w1',
          userId: 'u2',
          year: YEAR,
        }),
      },
      workspaceMember: {
        findMany: jest.fn().mockResolvedValue([
          { userId: 'u2', role: 'TESTER' },
          { userId: 'u1', role: 'MANAGER' },
          { userId: 'ghost', role: 'MEMBER' },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'u2', name: 'Zed', email: 'zed@x.com' },
          { id: 'u1', name: 'Amy', email: 'amy@x.com' },
        ]),
      },
    } as unknown as PrismaService;
    const access = {
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(opts.platformAdmin ?? false),
      can: jest.fn().mockResolvedValue(true),
      activeMembership: jest
        .fn()
        .mockResolvedValue(opts.isMember === false ? null : { id: 'm1' }),
      // The caller and one more approver, unless a case says otherwise.
      membersHolding: jest.fn().mockResolvedValue(opts.approvers ?? ['u1', 'u9']),
    } as unknown as WorkspaceAccessService;
    const emit = jest.fn();
    return {
      svc: new LeaveBalancesService(prisma, access, { emit } as never),
      upsert,
      update: updateMany,
      access,
      stored,
      emit,
    };
  }

  it('lists every active member — provisioning the ones who never opened Leave', async () => {
    const { svc, upsert, access } = buildTeam();
    const rows = await svc.team(user, 'w1');
    expect(access.assertPermission).toHaveBeenCalledWith(user, 'w1', Permission.LeaveApprove);
    // Sorted by name; the membership whose account is gone is left out.
    expect(rows.map((r) => [r.userName, r.userId, r.paidLeave])).toEqual([
      ['Amy', 'u1', 21],
      ['Zed', 'u2', 21],
    ]);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('sets a member’s allowance, and only the figures it was given', async () => {
    const { svc, update } = buildTeam();
    await expect(
      svc.adjust(user, { workspaceId: 'w1', userId: 'u2', year: YEAR, compOff: 2 }),
    ).resolves.toMatchObject({ userId: 'u2', compOff: 2, paidLeave: 21 });
    expect(update.mock.calls[0][0].data).toEqual({ compOff: 2 });
  });

  // The dialog opened on 21 days; an approval took it to 16; the approver typed
  // 25. Written as an absolute figure, that handed the five approved days back.
  it('refuses a figure that moved while the approver was editing it', async () => {
    const { svc, stored, emit } = buildTeam({ stored: { paidLeave: 16 } });
    await expect(
      svc.adjust(user, {
        workspaceId: 'w1', userId: 'u2', year: YEAR, paidLeave: 25, basedOn: { paidLeave: 21 },
      }),
    ).rejects.toThrow(/Paid leave changed from 21 to 16/);
    expect(stored.paidLeave).toBe(16);
    // Nobody is told about a change that was not made.
    expect(emit).not.toHaveBeenCalled();
  });

  it('writes when the figure is still what the approver saw', async () => {
    const { svc, update } = buildTeam();
    await expect(
      svc.adjust(user, {
        workspaceId: 'w1', userId: 'u2', year: YEAR, paidLeave: 25, basedOn: { paidLeave: 21 },
      }),
    ).resolves.toMatchObject({ paidLeave: 25 });
    expect(update.mock.calls[0][0].where).toEqual({ id: 'bal-u2', paidLeave: 21 });
  });

  it('checks only the figures being written', async () => {
    // Comp-off moved since; paid leave is what is being changed, and has not.
    const { svc } = buildTeam({ stored: { compOff: 3 } });
    await expect(
      svc.adjust(user, {
        workspaceId: 'w1', userId: 'u2', year: YEAR, paidLeave: 25,
        basedOn: { paidLeave: 21, compOff: 0 },
      }),
    ).resolves.toMatchObject({ paidLeave: 25, compOff: 3 });
  });

  it('refuses an approver changing their own balance', async () => {
    const { svc, update } = buildTeam();
    await expect(
      svc.adjust(user, { workspaceId: 'w1', userId: 'u1', year: YEAR, paidLeave: 99 }),
    ).rejects.toThrow('You cannot change your own leave balance.');
    expect(update).not.toHaveBeenCalled();
  });

  // The leave rule: when nobody else approves leave here, there is nobody else
  // to ask, and the only approver's own allowance was nobody's to change.
  it('lets the only approver change their own balance', async () => {
    const { svc, update } = buildTeam({ approvers: ['u1'] });
    await svc.adjust(user, { workspaceId: 'w1', userId: 'u1', year: YEAR, paidLeave: 22 });
    expect(update).toHaveBeenCalled();
  });

  it('refuses a subject who is not an active member of the workspace', async () => {
    const { svc, upsert } = buildTeam({ isMember: false });
    await expect(
      svc.adjust(user, { workspaceId: 'w1', userId: 'stranger', year: YEAR, paidLeave: 5 }),
    ).rejects.toThrow('That person is not an active member of this workspace.');
    // No row is provisioned for somebody who does not belong here.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a year outside the balance window', async () => {
    const { svc } = buildTeam();
    await expect(svc.team(user, 'w1', 1990)).rejects.toThrow(/year must be/i);
    await expect(
      svc.adjust(user, { workspaceId: 'w1', userId: 'u2', year: 1990, paidLeave: 5 }),
    ).rejects.toThrow(/year must be/i);
  });
});

describe('LeaveRequestsService — when leave may start', () => {
  const user = { id: 'u1', name: 'Dev' } as never;
  const ask = (type: string, startDate: string, endDate = startDate) => ({
    workspaceId: 'w1',
    type,
    startDate,
    endDate,
    reason: 'because',
  });

  // The form refused every past date and the API accepted any, so the rule was
  // whichever door was used. "Today" here is Monday 20 July 2026.
  it('planned leave has to be asked for before it starts', async () => {
    const { svc, create } = build();
    await expect(svc.create(user, ask('CASUAL', '2026-07-17') as never)).rejects.toThrow(
      /has to be requested before it starts/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('starting today is not the past', async () => {
    const { svc, create } = build();
    await svc.create(user, ask('CASUAL', '2026-07-20') as never);
    expect(create).toHaveBeenCalled();
  });

  it('sickness can be recorded afterwards — that is when it is reported', async () => {
    const { svc, create } = build();
    await svc.create(user, ask('SICK', '2026-07-16', '2026-07-17') as never);
    expect((create.mock.calls[0][0] as { data: Array<{ daysCount: number }> }).data[0].daysCount).toBe(2);
  });

  it('but not without limit', async () => {
    const { svc, create } = build();
    await expect(svc.create(user, ask('SICK', '2026-06-01') as never)).rejects.toThrow(
      /up to 30 days after the fact/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe('LeaveRequestsService — what everybody may know about leave', () => {
  const user = { id: 'u1', name: 'Dev' } as never;

  it('who is away: the dates and the person, never the type or the reason', async () => {
    const { svc, prisma, access } = build();
    (prisma.leaveRequest.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'l1',
        userId: 'u9',
        startDate: new Date('2026-08-03'),
        endDate: new Date('2026-08-05'),
        type: 'SICK',
      },
      {
        id: 'l2',
        userId: 'u9',
        startDate: new Date('2026-08-10'),
        endDate: new Date('2026-08-10'),
        type: 'HALF_DAY',
      },
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u9', name: 'Asha', email: 'a@x' }]);
    const away = await svc.away(user, 'w1', '2026-08-01', '2026-08-31');
    expect(away).toEqual([
      { id: 'l1', userId: 'u9', userName: 'Asha', startDate: '2026-08-03', endDate: '2026-08-05', halfDay: false },
      { id: 'l2', userId: 'u9', userName: 'Asha', startDate: '2026-08-10', endDate: '2026-08-10', halfDay: true },
    ]);
    // Approved only, for this workspace, overlapping the window — and open to
    // any member, not only to whoever approves leave.
    expect((prisma.leaveRequest.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      workspaceId: 'w1',
      status: 'APPROVED',
    });
    expect(access.assertPermission).toHaveBeenCalledWith(user, 'w1', 'hr:read');
  });

  it('who decides leave here, by name', async () => {
    const { svc, prisma, access } = build();
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'mgr', name: '', email: 'm@x' }]);
    expect(await svc.approvers(user, 'w1')).toEqual([{ userId: 'mgr', name: 'm@x' }]);
    expect(access.membersHolding).toHaveBeenCalledWith('w1', 'leave:approve');
  });
});
