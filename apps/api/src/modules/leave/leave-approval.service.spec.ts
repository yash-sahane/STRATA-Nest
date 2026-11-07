import type { PrismaService } from '@strata/prisma';
import { businessDayMarker } from '@strata/config';
import type { User } from '@prisma/client';
import { LeaveApprovalService } from './leave-approval.service';
import { LEAVE_TYPE_TO_BALANCE_FIELD, countWorkingDays, requiredUnits } from './leave-balance';

describe('leave-balance mapping (ported source of truth)', () => {
  it('maps leave types to balance fields', () => {
    expect(LEAVE_TYPE_TO_BALANCE_FIELD.CASUAL).toBe('paidLeave');
    expect(LEAVE_TYPE_TO_BALANCE_FIELD.SICK).toBe('paidLeave');
    expect(LEAVE_TYPE_TO_BALANCE_FIELD.UNPAID).toBe('unpaidLeave');
    expect(LEAVE_TYPE_TO_BALANCE_FIELD.HALF_DAY).toBe('halfDay');
    expect(LEAVE_TYPE_TO_BALANCE_FIELD.COMP_OFF).toBe('compOff');
  });
  it('requiredUnits: HALF_DAY = 1, else ceil(days)', () => {
    expect(requiredUnits('HALF_DAY', 0.5)).toBe(1);
    expect(requiredUnits('CASUAL', 2.2)).toBe(3);
    expect(requiredUnits('ANNUAL', 5)).toBe(5);
  });
  it('requiredUnits never returns a negative (a credit) for a bad daysCount', () => {
    expect(requiredUnits('CASUAL', -30)).toBe(0);
  });
  it('countWorkingDays honours the alternate-Saturday rule attendance uses', () => {
    // 2026-08-01 is a week-1 Saturday → a working day.
    expect(countWorkingDays(new Date('2026-08-01'), new Date('2026-08-01'))).toBe(1);
    // 2026-08-08 is a week-2 Saturday, 2026-08-09 a Sunday → no working days.
    expect(countWorkingDays(new Date('2026-08-08'), new Date('2026-08-09'))).toBe(0);
  });
});

const BALANCE = { id: 'b1', paidLeave: 21, unpaidLeave: 0, halfDay: 12, compOff: 0 };

function build(
  partial: Record<string, unknown>,
  opts: {
    covered?: boolean;
    balance?: typeof BALANCE;
    employee?: null;
    /** Declared (non-optional) holidays inside the leave's range. */
    holidays?: Date[];
    /** Everybody in the workspace who can approve leave. */
    approvers?: string[];
  } = {},
) {
  // Complete the row so leaveRequestResponse (which reads dates) doesn't crash.
  const request = {
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    endDate: partial.startDate,
    reason: '',
    approvedBy: '',
    approvedAt: null,
    rejectionReason: '',
    createdById: 'u2',
    createdByName: '',
    ...partial,
  };
  // A row that actually carries a mutable status, so the compare-and-swap the
  // service now relies on can be EXERCISED rather than assumed: `updateMany`
  // only matches while the row still holds the status the caller decided
  // against, exactly as `UPDATE ... WHERE status = $1` does in Postgres.
  const row: Record<string, unknown> = { ...request };
  const leaveRequest = {
    // What the service READ earlier (load(), cancel()) is the request as it was
    // handed in; a probe asking for a column (`select`) after a failed claim
    // sees the row as it is now.
    findUnique: jest.fn(async (args?: { select?: unknown }) => (args?.select ? { ...row } : request)),
    findUniqueOrThrow: jest.fn(async () => ({ ...row })),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      return { ...row };
    }),
    // Matches only while EVERY column it names still holds what it names —
    // `UPDATE ... WHERE status = $1 AND days_count = $2 ...` in Postgres.
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        for (const [key, expected] of Object.entries(where)) {
          if (key === 'id') continue;
          const actual = row[key];
          const same =
            expected instanceof Date
              ? actual instanceof Date && actual.getTime() === expected.getTime()
              : actual === expected;
          if (!same) return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
  };
  const leaveBalance = {
    upsert: jest.fn().mockResolvedValue(opts.balance ?? BALANCE),
    update: jest.fn().mockResolvedValue(opts.balance ?? BALANCE),
    updateMany: jest.fn().mockResolvedValue({ count: opts.covered === false ? 0 : 1 }),
  };
  const attendance = {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  // Approval reads the calendar before it lays the ON_LEAVE markers.
  const holiday = {
    findMany: jest.fn().mockResolvedValue((opts.holidays ?? []).map((date) => ({ date }))),
  };
  const tx = { leaveRequest, leaveBalance, attendance, holiday };
  const prisma = {
    leaveRequest,
    leaveBalance,
    attendance,
    holiday,
    // No settings: the business day is the server's zone.
    workspace: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.employee === null ? null : { email: 'u2@corp.com', name: 'Ada' }),
    },
    // No stored row means "everything on", which is what these cases assume.
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    // Model the ROLLBACK too: a body that throws must leave the row exactly as
    // it found it, which is what makes "the claim is undone when the balance
    // turns out not to cover it" a real assertion instead of a vacuous one.
    $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => {
      const snapshot = { ...row };
      try {
        return await fn(tx);
      } catch (err) {
        for (const key of Object.keys(row)) delete row[key];
        Object.assign(row, snapshot);
        throw err;
      }
    }),
  } as unknown as PrismaService;
  const access = {
    assertPermission: jest.fn().mockResolvedValue(undefined),
    can: jest.fn().mockResolvedValue(true),
    // Two approvers unless a case says otherwise: the manager and one other.
    membersHolding: jest.fn().mockResolvedValue(opts.approvers ?? ['mgr', 'mgr2']),
  } as never;
  const events = { emit: jest.fn() } as never;
  const email = { send: jest.fn().mockResolvedValue({ success: true }) };
  return {
    svc: new LeaveApprovalService(prisma, access, events, email as never),
    row,
    leaveRequest,
    leaveBalance,
    attendance,
    email,
  };
}

const mgr = { id: 'mgr' } as User;

describe('LeaveApprovalService.approve (D9 balance deduction)', () => {
  it('deducts paidLeave by ceil(days) for a paid type, only while it is covered', async () => {
    const { svc, leaveBalance } = build({
      id: 'lr1', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 2,
      startDate: new Date('2026-03-01'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr1');
    expect(leaveBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', paidLeave: { gte: 2 } },
      data: { paidLeave: { decrement: 2 } },
    });
  });

  it('increments unpaidLeave for UNPAID (no limit)', async () => {
    const { svc, leaveBalance } = build({
      id: 'lr2', workspaceId: 'w1', userId: 'u2', type: 'UNPAID', daysCount: 3,
      startDate: new Date('2026-03-01'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr2');
    expect(leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { unpaidLeave: { increment: 3 } },
    });
  });

  it('refuses to approve when the balance no longer covers the request', async () => {
    const { svc, row } = build(
      {
        id: 'lr4', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 25,
        startDate: new Date('2026-03-01'), status: 'PENDING',
      },
      { covered: false },
    );
    await expect(svc.approve(mgr, 'lr4')).rejects.toThrow(/insufficient leave balance/i);
    // The claim is written first and the transaction rolls it back, so the
    // request is still awaiting a decision rather than silently APPROVED.
    expect(row.status).toBe('PENDING');
    expect(row.approvedBy).toBe('');
  });

  it('charges the year the leave is TAKEN in, provisioning that row if needed', async () => {
    const { svc, leaveBalance } = build({
      id: 'lr5', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2027-01-04'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr5');
    expect(leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_userId_year: { workspaceId: 'w1', userId: 'u2', year: 2027 } },
      }),
    );
  });

  it('debits the allowance ONCE when two approvals land on the same request', async () => {
    // Both callers read PENDING (load() runs outside the transaction), so both
    // reach the body — as they did in production, where a one-day leave came
    // off the balance twice and cancelling refunded it once, leaving the member
    // permanently a day short with nothing in the record to explain it.
    const { svc, leaveBalance, row } = build({
      id: 'lr40', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-01'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr40');
    await expect(svc.approve({ id: 'mgr2' } as User, 'lr40')).rejects.toThrow(/already handled/i);
    expect(leaveBalance.updateMany).toHaveBeenCalledTimes(1);
    expect(row.approvedBy).toBe('mgr');
  });

  // The requester changed 1 day to 5 between the approval's read and its
  // claim: the request went on record APPROVED for 5 days with 1 debited, and
  // cancelling it later refunded 5.
  it('does not approve a request that changed after it was read', async () => {
    const { svc, row, leaveBalance, attendance } = build({
      id: 'lr42', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-02'), status: 'PENDING',
    });
    // The edit lands after load() read the request.
    Object.assign(row, { endDate: new Date('2026-03-06'), daysCount: 5 });
    await expect(svc.approve(mgr, 'lr42')).rejects.toThrow(/changed while you were deciding/);
    expect(row.status).toBe('PENDING');
    expect(leaveBalance.updateMany).not.toHaveBeenCalled();
    expect(attendance.createMany).not.toHaveBeenCalled();
  });

  it('charges what the claimed row says, and lays its markers', async () => {
    const { svc, leaveBalance, attendance, leaveRequest } = build({
      id: 'lr43', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2026-03-02'), endDate: new Date('2026-03-04'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr43');
    expect(leaveRequest.updateMany.mock.calls[0][0].where).toEqual({
      id: 'lr43',
      status: 'PENDING',
      type: 'CASUAL',
      startDate: new Date('2026-03-02'),
      endDate: new Date('2026-03-04'),
      daysCount: 3,
    });
    expect(leaveBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', paidLeave: { gte: 3 } },
      data: { paidLeave: { decrement: 3 } },
    });
    expect(attendance.createMany).toHaveBeenCalled();
  });

  it('an approval cannot overwrite a rejection that already landed', async () => {
    const { svc, row } = build({
      id: 'lr41', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-01'), status: 'PENDING',
    });
    await svc.reject(mgr, 'lr41', 'no cover that week');
    await expect(svc.approve({ id: 'mgr2' } as User, 'lr41')).rejects.toThrow(/already handled/i);
    expect(row.status).toBe('REJECTED');
    expect(row.rejectionReason).toBe('no cover that week');
  });

  it('blocks approving your own leave request', async () => {
    const { svc } = build({
      id: 'lr3', workspaceId: 'w1', userId: 'mgr', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-01'), status: 'PENDING',
    });
    await expect(svc.approve(mgr, 'lr3')).rejects.toThrow(/your own leave/i);
  });

  // With one approver in the workspace, that person's own request had nobody
  // to decide it: it stayed pending for good.
  it('lets the ONLY approver decide their own request', async () => {
    const { svc, row, leaveBalance } = build(
      {
        id: 'lr4', workspaceId: 'w1', userId: 'mgr', type: 'CASUAL', daysCount: 1,
        startDate: new Date('2026-03-02'), status: 'PENDING',
      },
      { approvers: ['mgr'] },
    );
    await svc.approve(mgr, 'lr4');
    expect(row.status).toBe('APPROVED');
    expect(row.approvedBy).toBe('mgr');
    expect(leaveBalance.updateMany).toHaveBeenCalled();
  });
});

describe('LeaveApprovalService.cancel', () => {
  const owner = { id: 'u2' } as User;

  it('restores the deducted units when an approved future leave is cancelled', async () => {
    const { svc, leaveBalance, leaveRequest } = build({
      id: 'lr6', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2099-03-01'), status: 'APPROVED',
    });
    await svc.cancel(owner, 'lr6');
    expect(leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { paidLeave: { increment: 3 } },
    });
    expect(leaveRequest.updateMany).toHaveBeenCalledWith({
      // Conditional on the status the cancellation was decided against, so two
      // simultaneous cancellations cannot both refund the allowance — and on the
      // end and days the refund is worked out from.
      where: {
        id: 'lr6',
        status: 'APPROVED',
        endDate: new Date('2099-03-01'),
        daysCount: 3,
      },
      data: { status: 'CANCELLED' },
    });
  });

  it('does not touch the balance when a pending request is withdrawn', async () => {
    const { svc, leaveBalance } = build({
      id: 'lr7', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2099-03-01'), status: 'PENDING',
    });
    await svc.cancel(owner, 'lr7');
    expect(leaveBalance.update).not.toHaveBeenCalled();
  });

  it('leaves leave that is over alone: it is a record of time taken', async () => {
    const { svc } = build({
      id: 'lr8', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2020-03-01'), status: 'APPROVED',
    });
    await expect(svc.cancel(mgr, 'lr8')).rejects.toThrow(/over/i);
  });

  describe('leave under way', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const today = businessDayMarker();
    /** Two weeks of leave that began a week ago — working days on both sides of today. */
    const running = (id: string) => ({
      id, workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 10,
      startDate: new Date(today.getTime() - 7 * DAY),
      endDate: new Date(today.getTime() + 7 * DAY),
      status: 'APPROVED',
    });

    it('an approver ends it early: it ends yesterday, and the days not taken go back', async () => {
      const req = running('lr11');
      const { svc, row, leaveBalance, attendance } = build(req);
      await svc.cancel(mgr, 'lr11');
      const yesterday = new Date(today.getTime() - DAY);
      expect(row.endDate).toEqual(yesterday);
      expect(row.status).toBe('APPROVED');
      const taken = countWorkingDays(req.startDate, yesterday);
      expect(row.daysCount).toBe(taken);
      expect(leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { paidLeave: { increment: 10 - taken } },
      });
      // Only the markers from today on come off; the days taken stay taken.
      expect(attendance.deleteMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'w1', userId: 'u2', status: 'ON_LEAVE',
          date: { gte: today, lte: req.endDate },
        },
      });
    });

    it('its owner asks an approver, unless they are the only one', async () => {
      const { svc } = build(running('lr12'));
      await expect(svc.cancel(owner, 'lr12')).rejects.toThrow(/somebody who approves leave/i);
      const alone = build(running('lr13'), { approvers: ['u2'] });
      await alone.svc.cancel(owner, 'lr13');
      expect(alone.row.endDate).toEqual(new Date(today.getTime() - DAY));
    });

    /** A week of leave that begins today. */
    const startingToday = (id: string) => ({
      id, workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 5,
      startDate: today,
      endDate: new Date(today.getTime() + 6 * DAY),
      status: 'APPROVED',
    });

    // `startDate < today` read a leave starting today as not yet begun, so its
    // owner could withdraw it on the morning they were off and have that day
    // handed back as well.
    it('has begun on its first day: its owner cannot withdraw it themselves', async () => {
      const { svc, row, leaveBalance } = build(startingToday('lr14'));
      await expect(svc.cancel(owner, 'lr14')).rejects.toThrow(/has started/i);
      expect(row.status).toBe('APPROVED');
      expect(leaveBalance.update).not.toHaveBeenCalled();
    });

    it('an approver ending it on its first day withdraws it — none of it was taken', async () => {
      const { svc, row, leaveBalance } = build(startingToday('lr15'));
      await svc.cancel(mgr, 'lr15');
      expect(row.status).toBe('CANCELLED');
      expect(leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { paidLeave: { increment: 5 } },
      });
    });
  });

  it('withdraws only the ON_LEAVE markers the approval wrote', async () => {
    const { svc, attendance } = build({
      id: 'lr9', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2099-03-01'), endDate: new Date('2099-03-03'), status: 'APPROVED',
    });
    await svc.cancel(owner, 'lr9');
    expect(attendance.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'w1',
        userId: 'u2',
        status: 'ON_LEAVE',
        date: { gte: new Date('2099-03-01'), lte: new Date('2099-03-03') },
      },
    });
  });

  it('leaves attendance alone when a pending request is withdrawn', async () => {
    const { svc, attendance } = build({
      id: 'lr10', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2099-03-01'), status: 'PENDING',
    });
    await svc.cancel(owner, 'lr10');
    expect(attendance.deleteMany).not.toHaveBeenCalled();
  });
});

describe('LeaveApprovalService — ON_LEAVE attendance markers', () => {
  it('writes one ON_LEAVE row per covered working day, never overwriting a real check-in', async () => {
    const { svc, attendance } = build({
      id: 'lr20', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2026-03-02'), endDate: new Date('2026-03-04'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr20');
    const [arg] = attendance.createMany.mock.calls[0] as [
      { data: Array<{ date: Date; status: string }>; skipDuplicates: boolean },
    ];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    expect(arg.data.every((r) => r.status === 'ON_LEAVE')).toBe(true);
  });

  it('skips non-working days inside the range', async () => {
    const { svc, attendance } = build({
      id: 'lr21', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 2,
      // Sat 2026-03-07 is a week-1 (working) Saturday; Sun 2026-03-08 is not.
      startDate: new Date('2026-03-07'), endDate: new Date('2026-03-09'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr21');
    const [arg] = attendance.createMany.mock.calls[0] as [{ data: Array<{ date: Date }> }];
    expect(arg.data.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      '2026-03-07',
      '2026-03-09',
    ]);
  });

  it('does not mark a HALF_DAY leave — the member still works (and checks in) that day', async () => {
    const { svc, attendance } = build({
      id: 'lr22', workspaceId: 'w1', userId: 'u2', type: 'HALF_DAY', daysCount: 0.5,
      startDate: new Date('2026-03-02'), status: 'PENDING',
    });
    await svc.approve(mgr, 'lr22');
    expect(attendance.createMany).not.toHaveBeenCalled();
  });
});

describe('LeaveApprovalService decision email (rendered server-side)', () => {
  it('mails the requester on approval, addressed from the stored user record', async () => {
    const { svc, email } = build({
      id: 'lr30', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-02'), status: 'PENDING',
    });
    await svc.approve({ id: 'mgr', name: 'Grace' } as User, 'lr30');
    const [job] = email.send.mock.calls[0] as [
      { to: string; subject: string; html: string; idempotencyKey: string },
    ];
    expect(job.to).toBe('u2@corp.com');
    expect(job.subject).toMatch(/approved/i);
    expect(job.html).toContain('Grace');
    expect(job.idempotencyKey).toBe('leave-approved:lr30');
  });

  it('escapes the rejection reason so a manager cannot inject markup', async () => {
    const { svc, email } = build({
      id: 'lr31', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-02'), status: 'PENDING',
    });
    await svc.reject(mgr, 'lr31', '<script>alert(1)</script>');
    const [job] = email.send.mock.calls[0] as [{ html: string; subject: string }];
    expect(job.subject).toMatch(/rejected/i);
    expect(job.html).not.toContain('<script>');
    expect(job.html).toContain('&lt;script&gt;');
  });

  it('never fails the decision when the mail cannot be produced', async () => {
    const { svc, email, leaveRequest } = build({
      id: 'lr32', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 1,
      startDate: new Date('2026-03-02'), status: 'PENDING',
    });
    email.send.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.approve(mgr, 'lr32')).resolves.toMatchObject({ status: 'APPROVED' });
    expect(leaveRequest.updateMany).toHaveBeenCalled();
  });
});

describe('LeaveApprovalService — a holiday inside the leave', () => {
  // The request was not charged for the holiday, and the office is shut: the
  // markers used to be laid without looking, so the team view showed somebody
  // "on leave" on a day nobody was working.
  it('lays no ON_LEAVE marker on a declared holiday', async () => {
    const { svc, attendance } = build(
      {
        id: 'lr9', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 2,
        startDate: new Date('2026-03-02'), endDate: new Date('2026-03-04'), status: 'PENDING',
      },
      { holidays: [new Date('2026-03-03')] },
    );
    await svc.approve({ id: 'mgr' } as User, 'lr9');
    const { data } = attendance.createMany.mock.calls[0][0] as { data: Array<{ date: Date }> };
    expect(data.map((marker) => marker.date.toISOString().slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-04',
    ]);
  });
});
