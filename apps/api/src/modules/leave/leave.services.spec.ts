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

function build(
  opts: {
    row?: Record<string, unknown>;
    clash?: { id: string } | null;
    open?: Array<{ type: string; daysCount: number; startDate: Date }>;
    balance?: typeof BALANCE;
    canApprove?: boolean;
    holidays?: Array<{ date: Date }>;
  } = {},
) {
  const create = jest.fn().mockResolvedValue(ROW);
  const update = jest.fn().mockResolvedValue(ROW);
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
      create,
      update,
      delete: remove,
    },
    leaveBalance: { upsert: jest.fn().mockResolvedValue(opts.balance ?? BALANCE) },
    // Public holidays are excluded from the day count, so resolveRange loads them.
    holiday: { findMany: jest.fn().mockResolvedValue(opts.holidays ?? []) },
    // `create` runs its overlap + affordability checks under a transaction-scoped
    // advisory lock, so concurrent submissions from one member queue up rather
    // than both passing a check-then-act race. The mock just runs the callback.
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      Promise.resolve(fn({ $executeRaw: jest.fn().mockResolvedValue(1) })),
    ),
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(opts.canApprove ?? false),
  } as unknown as WorkspaceAccessService;
  return { svc: new LeaveRequestsService(prisma, access), create, update, findMany, remove };
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
      data: expect.objectContaining({ daysCount: 1, userId: 'u1', status: 'PENDING' }),
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
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ daysCount: 2 }) });
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
      'You do not have permission to perform this action.',
    );
  });

  it('a reason-only edit does not re-run the balance/overlap checks', async () => {
    // Re-validating unconditionally meant fixing a typo could 400 with
    // "Insufficient leave balance" — the balance had legitimately moved since
    // the request was filed — and silently rewrote `daysCount` on legacy rows,
    // changing what approval would deduct. Nothing about the dates changed.
    const { svc, update } = build({ balance: { ...BALANCE, paidLeave: 0 } });
    await expect(svc.patch(user, 'lr1', { reason: 'typo fixed' })).resolves.toBeDefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'lr1' }, data: { reason: 'typo fixed' } });
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
