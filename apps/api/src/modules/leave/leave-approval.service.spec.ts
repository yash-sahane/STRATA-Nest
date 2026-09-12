import type { PrismaService } from '@strata/prisma';
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
  opts: { covered?: boolean; balance?: typeof BALANCE; employee?: null } = {},
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
    findUnique: jest.fn().mockResolvedValue(request),
    findUniqueOrThrow: jest.fn(async () => ({ ...row })),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.status !== undefined && where.status !== row.status) return { count: 0 };
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
  const tx = { leaveRequest, leaveBalance, attendance };
  const prisma = {
    leaveRequest,
    leaveBalance,
    attendance,
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.employee === null ? null : { email: 'u2@corp.com', name: 'Ada' }),
    },
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
      // simultaneous cancellations cannot both refund the allowance.
      where: { id: 'lr6', status: 'APPROVED' },
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

  it('refuses to cancel leave that has already started', async () => {
    const { svc } = build({
      id: 'lr8', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 3,
      startDate: new Date('2020-03-01'), status: 'APPROVED',
    });
    await expect(svc.cancel(owner, 'lr8')).rejects.toThrow(/already started/i);
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
