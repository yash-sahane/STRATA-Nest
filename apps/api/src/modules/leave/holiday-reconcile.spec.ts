import type { Prisma } from '@prisma/client';
import {
  reconcileCalendarDay,
  reconcileWorkingWeekChange,
  sameWorkingWeekFrom,
} from './holiday-reconcile';
import { LEAVE_TYPE_TO_BALANCE_FIELD } from './leave-balance';

/**
 * The leave half of a calendar change: an approved leave across the day is
 * re-counted, and its CHARGE moves towards what it now costs — from what was
 * actually charged, never from the old day count.
 *
 * Monday 9 to Wednesday 11 November 2026 is three working days; the holiday
 * that comes and goes is Tuesday the 10th.
 */
const MON = new Date('2026-11-09T00:00:00.000Z');
const TUE = new Date('2026-11-10T00:00:00.000Z');
const WED = new Date('2026-11-11T00:00:00.000Z');

type Row = Record<string, unknown>;

/** `UPDATE ... WHERE` every named column still holds what it names. */
const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === 'id') return row.id === expected;
    const actual = row[key];
    return expected instanceof Date
      ? actual instanceof Date && actual.getTime() === expected.getTime()
      : actual === expected;
  });

function build(opts: {
  /** Holidays on the calendar once the change has landed. */
  holidays?: Date[];
  request: Row;
  /** What is left on the balance the leave is charged to. */
  balanceLeft?: number;
  /** The workspace's stored settings (its working week). */
  settings?: Row;
  /** Attendance rows filed on the day being re-counted. */
  attendance?: Row[];
  /** Somebody else's write lands on the request the first time it is claimed. */
  changedUnderneath?: Row;
}) {
  const request: Row = {
    id: 'lr1',
    workspaceId: 'w1',
    userId: 'u2',
    status: 'APPROVED',
    startDate: MON,
    endDate: WED,
    createdByName: '',
    ...opts.request,
  };
  const field = LEAVE_TYPE_TO_BALANCE_FIELD[String(request.type)] ?? 'paidLeave';
  const balance = { id: 'b1', paidLeave: 0, unpaidLeave: 0, halfDay: 0, compOff: 0, [field]: opts.balanceLeft ?? 0 };
  const balanceUpdate = jest.fn().mockResolvedValue(balance);
  let interfered = false;
  const claim = jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
    if (opts.changedUnderneath && !interfered) {
      interfered = true;
      Object.assign(request, opts.changedUnderneath);
    }
    if (!matches(request, where)) return { count: 0 };
    Object.assign(request, data);
    return { count: 1 };
  });
  const holidays = (opts.holidays ?? []).map((date) => ({ date }));
  const attendanceRows = opts.attendance ?? [];
  const attendanceUpdate = jest.fn().mockResolvedValue({});
  const attendanceDelete = jest.fn().mockResolvedValue({});
  const markers = jest.fn(async ({ data }: { data: Row[] }) => data);
  const tx = {
    holiday: {
      count: jest.fn(async ({ where }: { where: { date: Date } }) =>
        holidays.filter((h) => h.date.getTime() === where.date.getTime()).length,
      ),
      findMany: jest.fn().mockResolvedValue(holidays),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ settings: opts.settings ?? {} }) },
    attendance: {
      findMany: jest.fn().mockResolvedValue(attendanceRows),
      update: attendanceUpdate,
      delete: attendanceDelete,
      createManyAndReturn: markers,
      aggregate: jest.fn().mockResolvedValue({ _max: { date: null } }),
    },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([{ ...request }]),
      findUnique: jest.fn(async () => ({ ...request })),
      updateMany: claim,
      aggregate: jest.fn().mockResolvedValue({ _max: { endDate: request.endDate } }),
    },
    leaveBalance: { upsert: jest.fn().mockResolvedValue(balance), update: balanceUpdate },
  };
  return {
    tx: tx as unknown as Prisma.TransactionClient,
    request,
    balanceUpdate,
    claim,
    field,
    markers,
    attendanceUpdate,
    attendanceDelete,
  };
}

describe('reconcileCalendarDay — what an approved leave is charged', () => {
  it('a holiday declared inside it gives the day back, and the charge drops with it', async () => {
    const { tx, request, balanceUpdate, field } = build({
      holidays: [TUE],
      request: { type: 'CASUAL', daysCount: 3, chargedUnits: 3 },
      balanceLeft: 5,
    });
    const result = await reconcileCalendarDay(tx, 'w1', TUE);
    expect(balanceUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { [field]: { increment: 1 } } });
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
    expect(result.daysReturned).toBe(1);
    // The conditional write is invisible to the hook: the caller announces it.
    expect(result.unannounced).toEqual([
      expect.objectContaining({ model: 'LeaveRequest', action: 'update' }),
    ]);
  });

  it('a holiday withdrawn charges the day again — only as far as the balance covers it', async () => {
    const { tx, request, balanceUpdate } = build({
      request: { type: 'CASUAL', daysCount: 2, chargedUnits: 2 },
      balanceLeft: 0,
    });
    const result = await reconcileCalendarDay(tx, 'w1', TUE);
    // The leave stands; nobody is overdrawn for the calendar changing.
    expect(balanceUpdate).not.toHaveBeenCalled();
    // The leave is three days long now, but it was charged for two.
    expect(request).toEqual(expect.objectContaining({ daysCount: 3, chargedUnits: 2 }));
    expect(result.daysReturned).toBe(0);
  });

  // The drift this column exists for: counted from the day count, putting the
  // holiday back "returned" the day the withdrawal could not charge.
  it('putting that holiday back gives back nothing: nothing was charged for the day', async () => {
    const { tx, request, balanceUpdate } = build({
      holidays: [TUE],
      request: { type: 'CASUAL', daysCount: 3, chargedUnits: 2 },
      balanceLeft: 0,
    });
    await reconcileCalendarDay(tx, 'w1', TUE);
    expect(balanceUpdate).not.toHaveBeenCalled();
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
  });

  it('unpaid leave counts days taken: a holiday inside it takes one off, never below zero', async () => {
    const { tx, request, balanceUpdate } = build({
      holidays: [TUE],
      request: { type: 'UNPAID', daysCount: 3, chargedUnits: 3 },
      balanceLeft: 3,
    });
    await reconcileCalendarDay(tx, 'w1', TUE);
    expect(balanceUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { unpaidLeave: { increment: -1 } },
    });
    expect(request).toEqual(expect.objectContaining({ daysCount: 2, chargedUnits: 2 }));
  });
});

describe('reconcileCalendarDay — a request that changes under the re-count', () => {
  it('is claimed on the figures it was counted from', async () => {
    const { tx, claim } = build({
      holidays: [TUE],
      request: { type: 'CASUAL', daysCount: 3, chargedUnits: 3 },
      balanceLeft: 5,
    });
    await reconcileCalendarDay(tx, 'w1', TUE);
    expect(claim).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'lr1', status: 'APPROVED', daysCount: 3, chargedUnits: 3 }),
      data: { daysCount: 2, chargedUnits: 2 },
    });
  });

  // An approval landing between the read and the write charged three days. An
  // unconditional write put the count at two and left that charge as it was:
  // the member paid for the holiday after all.
  it('is read again and counted as it now stands: approved while it was being re-counted', async () => {
    const { tx, request, balanceUpdate, claim, field } = build({
      holidays: [TUE],
      request: { type: 'CASUAL', status: 'PENDING', daysCount: 3, chargedUnits: 0 },
      balanceLeft: 5,
      changedUnderneath: { status: 'APPROVED', chargedUnits: 3 },
    });
    await reconcileCalendarDay(tx, 'w1', TUE);
    expect(claim).toHaveBeenCalledTimes(2);
    // Second time round it is approved, so the day the approval charged comes back.
    expect(request).toEqual(expect.objectContaining({ status: 'APPROVED', daysCount: 2, chargedUnits: 2 }));
    expect(balanceUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { [field]: { increment: 1 } } });
  });

  it('is left alone once it is no longer open: rejected while it was being re-counted', async () => {
    const { tx, request, claim } = build({
      holidays: [TUE],
      request: { type: 'CASUAL', status: 'PENDING', daysCount: 3, chargedUnits: 0 },
      changedUnderneath: { status: 'REJECTED' },
    });
    const result = await reconcileCalendarDay(tx, 'w1', TUE);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(request).toEqual(expect.objectContaining({ status: 'REJECTED', daysCount: 3 }));
    expect(result.leaveRequests).toBe(0);
  });
});

/**
 * The working week. 14 November 2026 is the 2nd Saturday of the month — off by
 * default; 7 November is the 1st — worked by default.
 */
const SAT_WEEK1 = new Date('2026-11-07T00:00:00.000Z');
const SAT_WEEK2 = new Date('2026-11-14T00:00:00.000Z');
const FRI = new Date('2026-11-13T00:00:00.000Z');
const MON_AFTER = new Date('2026-11-16T00:00:00.000Z');

describe('reconcileCalendarDay — a Saturday that starts or stops being worked', () => {
  it('a leave across a Saturday the workspace now works costs that day too', async () => {
    const { tx, request, balanceUpdate, markers, field } = build({
      // Every Saturday worked from the 8th on.
      settings: { workingWeek: [{ from: '2026-11-08', saturdays: [1, 2, 3, 4, 5] }] },
      request: { type: 'CASUAL', startDate: FRI, endDate: MON_AFTER, daysCount: 2, chargedUnits: 2 },
      balanceLeft: 5,
    });
    await reconcileCalendarDay(tx, 'w1', SAT_WEEK2);
    expect(request).toEqual(expect.objectContaining({ daysCount: 3, chargedUnits: 3 }));
    expect(balanceUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { [field]: { increment: -1 } } });
    // The Saturday is a leave day now, and the calendar says so.
    expect(markers).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ date: SAT_WEEK2, status: 'ON_LEAVE' })],
        skipDuplicates: true,
      }),
    );
  });

  it('a Saturday no longer worked loses its leave marker, and check-ins on it are not late', async () => {
    const lateArrival = new Date('2026-11-07T11:00:00.000Z');
    const { tx, attendanceUpdate, attendanceDelete } = build({
      // No Saturday worked from the 1st on.
      settings: { workingWeek: [{ from: '2026-11-01', saturdays: [] }], timezone: 'UTC' },
      request: { type: 'CASUAL', startDate: MON, endDate: WED, daysCount: 3, chargedUnits: 3 },
      attendance: [
        // An approved leave's marker on the day.
        { id: 'a-marker', status: 'ON_LEAVE', checkInTime: SAT_WEEK1, checkOutTime: null, date: SAT_WEEK1, isHoliday: false, isWeekend: false },
        // Somebody who came in, filed late against the working day it was.
        { id: 'a-in', status: 'LATE', checkInTime: lateArrival, checkOutTime: null, date: SAT_WEEK1, isHoliday: false, isWeekend: false, workHours: null },
      ],
    });
    await reconcileCalendarDay(tx, 'w1', SAT_WEEK1);
    expect(attendanceDelete).toHaveBeenCalledWith({ where: { id: 'a-marker' } });
    expect(attendanceUpdate).toHaveBeenCalledWith({
      where: { id: 'a-in' },
      data: expect.objectContaining({ isWeekend: true, isHoliday: false, lateMinutes: 0, status: 'PRESENT' }),
    });
  });
});

describe('reconcileWorkingWeekChange — from today on, and only the Saturdays it flips', () => {
  it('visits each Saturday whose standing changed, up to the furthest leave on record', async () => {
    const { tx } = build({
      settings: { workingWeek: [{ from: '2026-11-02', saturdays: [1, 2, 3] }] },
      request: { type: 'CASUAL', startDate: MON, endDate: new Date('2026-11-30T00:00:00.000Z'), daysCount: 16, chargedUnits: 16 },
      balanceLeft: 10,
    });
    const visited: string[] = [];
    (tx.attendance.findMany as unknown as jest.Mock).mockImplementation(
      async ({ where }: { where: { date: Date } }) => {
        visited.push(where.date.toISOString().slice(0, 10));
        return [];
      },
    );
    await reconcileWorkingWeekChange(
      tx,
      'w1',
      new Date('2026-11-02T00:00:00.000Z'),
      [],
      [{ from: '2026-11-02', saturdays: [1, 2, 3] }],
    );
    // 7th (week 1) and 21st (week 3) were already worked and still are; 28th
    // (week 4) still is not. Only the 14th — week 2 — changed.
    expect(visited).toEqual(['2026-11-14']);
  });

  it('looks at nothing when nothing is recorded from today on', async () => {
    const { tx } = build({ request: { type: 'CASUAL', daysCount: 3, chargedUnits: 3 } });
    (tx.leaveRequest.aggregate as unknown as jest.Mock).mockResolvedValue({ _max: { endDate: null } });
    const result = await reconcileWorkingWeekChange(tx, 'w1', MON, [], [{ from: '2026-11-09', saturdays: [] }]);
    expect(result).toEqual({ attendanceRows: 0, leaveRequests: 0, daysReturned: 0 });
    expect(tx.attendance.findMany).not.toHaveBeenCalled();
  });
});

describe('sameWorkingWeekFrom', () => {
  it('a period added from today that restates the rule changes nothing', () => {
    expect(sameWorkingWeekFrom('2026-11-07', [], [{ from: '2026-11-07', saturdays: [1, 3] }])).toBe(true);
  });
  it('a different rule from today is a change', () => {
    expect(sameWorkingWeekFrom('2026-11-07', [], [{ from: '2026-11-07', saturdays: [] }])).toBe(false);
  });
});
