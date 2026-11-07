import type { PrismaService } from '@strata/prisma';
import { reconcileHolidayChange } from './holiday-reconcile';
import { LEAVE_TYPE_TO_BALANCE_FIELD } from './leave-balance';

/**
 * The leave half of a holiday change: an approved leave across the day is
 * re-counted, and its CHARGE moves towards what it now costs — from what was
 * actually charged, never from the old day count.
 *
 * Monday 9 to Wednesday 11 November 2026 is three working days; the holiday
 * that comes and goes is Tuesday the 10th.
 */
const MON = new Date('2026-11-09T00:00:00.000Z');
const TUE = new Date('2026-11-10T00:00:00.000Z');
const WED = new Date('2026-11-11T00:00:00.000Z');

function build(opts: {
  /** Whether Tuesday is a declared holiday once the change has landed. */
  tuesdayIsHoliday: boolean;
  request: { type: string; daysCount: number; chargedUnits: number };
  /** What is left on the balance the leave is charged to. */
  balanceLeft: number;
}) {
  const request = {
    id: 'lr1',
    workspaceId: 'w1',
    userId: 'u2',
    status: 'APPROVED',
    startDate: MON,
    endDate: WED,
    createdByName: '',
    ...opts.request,
  };
  const field = LEAVE_TYPE_TO_BALANCE_FIELD[opts.request.type] ?? 'paidLeave';
  const balance = { id: 'b1', paidLeave: 0, sickLeave: 0, unpaidLeave: 0, [field]: opts.balanceLeft };
  const balanceUpdate = jest.fn().mockResolvedValue(balance);
  const requestUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(request, data);
    return request;
  });
  const holidays = opts.tuesdayIsHoliday ? [{ date: TUE }] : [];
  const tx = {
    holiday: {
      count: jest.fn().mockResolvedValue(holidays.length),
      findMany: jest.fn().mockResolvedValue(holidays),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
    attendance: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([{ ...request }]), update: requestUpdate },
    leaveBalance: { upsert: jest.fn().mockResolvedValue(balance), update: balanceUpdate },
  };
  const prisma = {
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, request, balanceUpdate, field };
}

describe('reconcileHolidayChange — what an approved leave is charged', () => {
  it('a holiday declared inside it gives the day back, and the charge drops with it', async () => {
    const { prisma, request, balanceUpdate, field } = build({
      tuesdayIsHoliday: true,
      request: { type: 'CASUAL', daysCount: 3, chargedUnits: 3 },
      balanceLeft: 5,
    });
    const result = await reconcileHolidayChange(prisma, 'w1', TUE);
    expect(balanceUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { [field]: { increment: 1 } } });
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
    expect(result.daysReturned).toBe(1);
  });

  it('a holiday withdrawn charges the day again — only as far as the balance covers it', async () => {
    const { prisma, request, balanceUpdate } = build({
      tuesdayIsHoliday: false,
      request: { type: 'CASUAL', daysCount: 2, chargedUnits: 2 },
      balanceLeft: 0,
    });
    const result = await reconcileHolidayChange(prisma, 'w1', TUE);
    // The leave stands; nobody is overdrawn for the calendar changing.
    expect(balanceUpdate).not.toHaveBeenCalled();
    // The leave is three days long now, but it was charged for two.
    expect(request).toEqual(expect.objectContaining({ daysCount: 3, chargedUnits: 2 }));
    expect(result.daysReturned).toBe(0);
  });

  // The drift this column exists for: counted from the day count, putting the
  // holiday back "returned" the day the withdrawal could not charge.
  it('putting that holiday back gives back nothing: nothing was charged for the day', async () => {
    const { prisma, request, balanceUpdate } = build({
      tuesdayIsHoliday: true,
      request: { type: 'CASUAL', daysCount: 3, chargedUnits: 2 },
      balanceLeft: 0,
    });
    await reconcileHolidayChange(prisma, 'w1', TUE);
    expect(balanceUpdate).not.toHaveBeenCalled();
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
  });

  it('unpaid leave counts days taken: a holiday inside it takes one off, never below zero', async () => {
    const { prisma, request, balanceUpdate } = build({
      tuesdayIsHoliday: true,
      request: { type: 'UNPAID', daysCount: 3, chargedUnits: 3 },
      balanceLeft: 3,
    });
    await reconcileHolidayChange(prisma, 'w1', TUE);
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { unpaidLeave: { increment: -1 } },
    });
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
  });
});
