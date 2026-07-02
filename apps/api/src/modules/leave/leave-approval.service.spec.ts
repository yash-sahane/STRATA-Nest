import type { PrismaService } from '@lt/prisma';
import type { User } from '@prisma/client';
import { LeaveApprovalService } from './leave-approval.service';
import { LEAVE_TYPE_TO_BALANCE_FIELD, requiredUnits } from './leave-balance';

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
});

function build(partial: Record<string, unknown>, balance: { id: string } | null) {
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
  const updatedReq = { ...request, status: 'APPROVED' };
  const leaveRequest = {
    findUnique: jest.fn().mockResolvedValue(request),
    update: jest.fn().mockResolvedValue(updatedReq),
  };
  const leaveBalance = {
    findFirst: jest.fn().mockResolvedValue(balance),
    update: jest.fn().mockResolvedValue(balance),
  };
  const prisma = {
    leaveRequest,
    leaveBalance,
    $transaction: jest.fn().mockResolvedValue([updatedReq, balance]),
  } as unknown as PrismaService;
  const access = { assertPermission: jest.fn().mockResolvedValue(undefined) } as never;
  const events = { emit: jest.fn() } as never;
  return { svc: new LeaveApprovalService(prisma, access, events), leaveBalance };
}

const mgr = { id: 'mgr' } as User;

describe('LeaveApprovalService.approve (D9 balance deduction)', () => {
  it('deducts paidLeave by ceil(days) for a paid type', async () => {
    const { svc, leaveBalance } = build(
      { id: 'lr1', workspaceId: 'w1', userId: 'u2', type: 'CASUAL', daysCount: 2, startDate: new Date('2026-03-01') , status: 'PENDING' },
      { id: 'b1' },
    );
    await svc.approve(mgr, 'lr1');
    expect(leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { paidLeave: { decrement: 2 } },
    });
  });

  it('increments unpaidLeave for UNPAID (no limit)', async () => {
    const { svc, leaveBalance } = build(
      { id: 'lr2', workspaceId: 'w1', userId: 'u2', type: 'UNPAID', daysCount: 3, startDate: new Date('2026-03-01'), status: 'PENDING' },
      { id: 'b1' },
    );
    await svc.approve(mgr, 'lr2');
    expect(leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { unpaidLeave: { increment: 3 } },
    });
  });

  it('blocks approving your own leave request', async () => {
    const { svc } = build(
      { id: 'lr3', workspaceId: 'w1', userId: 'mgr', type: 'CASUAL', daysCount: 1, startDate: new Date('2026-03-01'), status: 'PENDING' },
      { id: 'b1' },
    );
    await expect(svc.approve(mgr, 'lr3')).rejects.toThrow(/your own leave/i);
  });
});
