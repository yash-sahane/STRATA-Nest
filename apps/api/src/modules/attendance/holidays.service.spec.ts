import type { PrismaService } from '@strata/prisma';
import type { User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import * as reconcile from '../leave/holiday-reconcile';
import { HolidaysService } from './attendance.services';

/**
 * A holiday and the re-count of the day it changes commit together or not at
 * all: they were two commits, and a failure between them left a holiday on the
 * calendar with the leave across it still charged for the day.
 */
const manager = { id: 'mgr', name: 'Mira' } as User;
const DAY = '2026-11-10';

function build(opts: { recountFails?: boolean } = {}) {
  const holidayRow = {
    id: 'h1',
    workspaceId: 'w1',
    name: 'Founders Day',
    date: new Date(`${DAY}T00:00:00.000Z`),
    isOptional: false,
    description: '',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const executeRaw = jest.fn().mockResolvedValue(1);
  const tx = {
    $executeRaw: executeRaw,
    holiday: {
      create: jest.fn().mockResolvedValue(holidayRow),
      update: jest.fn().mockResolvedValue(holidayRow),
      delete: jest.fn().mockResolvedValue(holidayRow),
    },
  };
  const audit = jest.fn().mockResolvedValue({});
  const announceWrite = jest.fn();
  const prisma = {
    holiday: { findFirst: jest.fn().mockResolvedValue(holidayRow) },
    activityLog: { create: audit },
    announceWrite,
    // The commit happens only when the body returns: a throw is a rollback.
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const access = {
    assertPermission: jest.fn().mockResolvedValue(undefined),
    scopeWhere: jest.fn().mockResolvedValue({}),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
  } as unknown as WorkspaceAccessService;
  const recount = jest.spyOn(reconcile, 'reconcileCalendarDay').mockImplementation(async () => {
    if (opts.recountFails) throw new Error('connection lost');
    return {
      attendanceRows: 0,
      leaveRequests: 1,
      daysReturned: 1,
      peopleCharged: ['u2'],
      unannounced: [{ model: 'LeaveRequest', action: 'update', row: { id: 'lr1' } }],
    };
  });
  const events = { emit: jest.fn() };
  const svc = new HolidaysService(prisma, access, events as never);
  return { svc, tx, executeRaw, recount, audit, announceWrite, prisma, events };
}

afterEach(() => jest.restoreAllMocks());

describe('HolidaysService — a calendar change and its re-count are one unit', () => {
  it('declares the holiday and re-counts its day on one transaction, after the calendar lock', async () => {
    const { svc, tx, executeRaw, recount } = build();
    const created = await svc.create(manager, {
      workspaceId: 'w1',
      name: 'Founders Day',
      date: DAY,
    } as never);
    const [sql, key] = executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('pg_advisory_xact_lock(');
    expect(key).toBe('calendar:w1');
    expect(recount).toHaveBeenCalledWith(tx, 'w1', new Date(`${DAY}T00:00:00.000Z`));
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.holiday.create.mock.invocationCallOrder[0],
    );
    // What it did is still reported — without the rows it announced.
    expect(created.reconciled).toEqual({
      attendanceRows: 0,
      leaveRequests: 1,
      daysReturned: 1,
      peopleCharged: ['u2'],
    });
  });

  it('announces what the hook could not see, and tells the people re-charged, after the commit', async () => {
    const { svc, announceWrite, events } = build();
    await svc.create(manager, { workspaceId: 'w1', name: 'Founders Day', date: DAY } as never);
    expect(announceWrite).toHaveBeenCalledWith('LeaveRequest', 'update', { id: 'lr1' });
    expect(events.emit).toHaveBeenCalled();
  });

  it('a re-count that fails takes the holiday with it: nothing recorded, nobody told', async () => {
    const { svc, audit, announceWrite, events } = build({ recountFails: true });
    await expect(
      svc.create(manager, { workspaceId: 'w1', name: 'Founders Day', date: DAY } as never),
    ).rejects.toThrow('connection lost');
    expect(audit).not.toHaveBeenCalled();
    expect(announceWrite).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('moving a holiday re-counts the day it left and the day it lands on, in the same transaction', async () => {
    const { svc, tx, recount } = build();
    await svc.patch(manager, 'h1', { date: '2026-11-12' } as never);
    expect(tx.holiday.update).toHaveBeenCalled();
    expect(recount.mock.calls.map(([db, , date]) => [db, date.toISOString().slice(0, 10)])).toEqual([
      [tx, '2026-11-10'],
      [tx, '2026-11-12'],
    ]);
  });

  it('removing one re-counts its day under the lock too', async () => {
    const { svc, tx, executeRaw, recount } = build();
    await svc.remove(manager, 'h1');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.holiday.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
    expect(recount).toHaveBeenCalledWith(tx, 'w1', new Date(`${DAY}T00:00:00.000Z`));
  });
});
