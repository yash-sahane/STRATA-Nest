import type { PrismaService } from '@strata/prisma';
import type { TimeEntry, User } from '@prisma/client';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { TimeEntriesService, overlapsWorkedTime } from './time-tracking.services';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A whole hour three days back: every window below sits safely in the past. */
const BASE = Math.floor((Date.now() - 3 * 24 * HOUR) / HOUR) * HOUR;
/** `BASE` plus some hours (and minutes). */
const at = (hours: number, minutes = 0) => new Date(BASE + hours * HOUR + minutes * MINUTE);

const me = { id: 'me', name: 'Me', email: 'me@x.com' } as User;

function entryRow(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'te1',
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: 'w1',
    userId: 'me',
    userName: 'Me',
    userEmail: 'me@x.com',
    createdById: 'me',
    createdByName: 'Me',
    taskId: '',
    taskTitle: '',
    taskHierarchyId: '',
    projectId: '',
    projectName: '',
    description: 'old words',
    // A timer's entry: a three-hour window recording two and a half hours —
    // half an hour of it was paused.
    startTime: at(9),
    endTime: at(12),
    duration: 150,
    isBillable: false,
    status: 'PENDING',
    approvedBy: '',
    approvedAt: null,
    rejectionReason: '',
    tags: [],
    ...overrides,
  } as TimeEntry;
}

function timeEntryDelegate(row: TimeEntry, existing: TimeEntry[], writes: number) {
  return {
    findFirst: jest.fn().mockResolvedValue(row),
    findMany: jest.fn().mockResolvedValue(existing),
    // The insert under the lock: `createManyAndReturn`, which the realtime
    // write hook does not see, so the frame can wait for the commit.
    createManyAndReturn: jest.fn(({ data }: { data: Array<Record<string, unknown>> }) =>
      Promise.resolve(data.map((d) => ({ ...row, ...d }))),
    ),
    updateMany: jest.fn().mockResolvedValue({ count: writes }),
    findUniqueOrThrow: jest.fn().mockResolvedValue(row),
    findUnique: jest.fn().mockResolvedValue(row),
    deleteMany: jest.fn().mockResolvedValue({ count: writes }),
  };
}

function build(
  opts: {
    row?: Partial<TimeEntry>;
    existing?: TimeEntry[];
    writes?: number;
    /** Give the transaction delegates of its own, to see which client did the work. */
    separateTx?: boolean;
  } = {},
) {
  const row = entryRow(opts.row);
  const timeEntry = timeEntryDelegate(row, opts.existing ?? [], opts.writes ?? 1);
  const txTimeEntry = opts.separateTx
    ? timeEntryDelegate(row, opts.existing ?? [], opts.writes ?? 1)
    : timeEntry;
  const order: string[] = [];
  const prisma = {
    timeEntry,
    // Saves that can overlap run under the per-person advisory lock, and do
    // their reading and writing on that transaction's own connection.
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
      const result = await fn({ $executeRaw: jest.fn().mockResolvedValue(1), timeEntry: txTimeEntry });
      order.push('commit');
      return result;
    }),
    announceWrite: jest.fn(() => order.push('announce')),
  } as unknown as PrismaService;
  const access = {
    scopeWhere: jest.fn().mockResolvedValue({ workspaceId: { in: ['w1'] } }),
    assertPermission: jest.fn().mockResolvedValue(undefined),
    isPlatformAdmin: jest.fn().mockReturnValue(false),
    can: jest.fn().mockResolvedValue(false),
  } as unknown as WorkspaceAccessService;
  return { svc: new TimeEntriesService(prisma, access), timeEntry, txTimeEntry, prisma, order, row };
}

const log = (startTime: Date, endTime: Date) => ({
  workspaceId: 'w1',
  description: 'work',
  startTime: startTime.toISOString(),
  endTime: endTime.toISOString(),
});

describe('TimeEntriesService — an entry is time already worked', () => {
  // Only the START was checked, so "today 09:00–17:00" typed in at lunchtime
  // went to the approver as eight hours worked, five of them still to come.
  it('refuses an entry that ends in the future', async () => {
    const { svc, timeEntry } = build();
    const now = Date.now();
    await expect(
      svc.create(me, log(new Date(now - HOUR), new Date(now + 2 * HOUR))),
    ).rejects.toThrow(/cannot end in the future/);
    expect(timeEntry.createManyAndReturn).not.toHaveBeenCalled();
  });
});

describe('TimeEntriesService — the same time logged twice', () => {
  it('refuses a window on top of one already logged, naming it', async () => {
    const logged = entryRow({ id: 'other', startTime: at(9), endTime: at(17), duration: 480, taskHierarchyId: 'TTV-1', taskTitle: 'Ship it' });
    const { svc, timeEntry } = build({ existing: [logged] });
    await expect(svc.create(me, log(at(10), at(11)))).rejects.toThrow(/TTV-1 Ship it/);
    expect(timeEntry.createManyAndReturn).not.toHaveBeenCalled();
    // Asked of the caller's own, un-rejected entries in this workspace only.
    expect(timeEntry.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'me',
      workspaceId: 'w1',
      status: { not: 'REJECTED' },
      startTime: { lt: at(11) },
      endTime: { gt: at(10) },
    });
  });

  it('lets windows touch, and a stray few seconds of a timer overlap', async () => {
    const stoppedLate = entryRow({ id: 'other', startTime: at(9), endTime: at(11, 0.33), duration: 120 });
    const { svc, timeEntry } = build({ existing: [stoppedLate] });
    await svc.create(me, log(at(11), at(12)));
    expect(timeEntry.createManyAndReturn).toHaveBeenCalled();
  });

  // The check and the insert used the shared client while the lock sat on the
  // transaction's connection: two connections per save, so a burst of saves
  // filled the pool with lock waiters and the holder starved — 98 of 110 entries
  // refused with "Transaction already closed".
  it('checks and inserts on the lock’s own transaction, and announces after it commits', async () => {
    const { svc, timeEntry, txTimeEntry, prisma, order } = build({ separateTx: true });
    const created = await svc.create(me, log(at(11), at(12)));
    expect(txTimeEntry.findMany).toHaveBeenCalled();
    expect(txTimeEntry.createManyAndReturn).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'me', workspaceId: 'w1', duration: 60, status: 'PENDING' })],
    });
    expect(timeEntry.findMany).not.toHaveBeenCalled();
    expect(timeEntry.createManyAndReturn).not.toHaveBeenCalled();
    expect(prisma.announceWrite).toHaveBeenCalledWith(
      'TimeEntry',
      'create',
      expect.objectContaining({ id: created.id }),
    );
    expect(order).toEqual(['commit', 'announce']);
  });

  it('a window edit re-checks on the lock’s transaction too', async () => {
    const { svc, timeEntry, txTimeEntry } = build({ separateTx: true });
    await svc.patch(me, 'te1', { startTime: at(13).toISOString(), endTime: at(14).toISOString() });
    expect(txTimeEntry.findMany).toHaveBeenCalled();
    expect(txTimeEntry.updateMany).toHaveBeenCalled();
    expect(timeEntry.updateMany).not.toHaveBeenCalled();
  });

  // A paused timer's entry covers more window than it records, and where the
  // pause fell is not stored: time logged by hand may sit in that gap.
  it('allows what fits in a paused timer’s gap, and refuses what cannot', () => {
    const paused = entryRow(); // 09:00–12:00 recording 150 minutes
    expect(overlapsWorkedTime(paused, at(10), at(10, 30))).toBe(false);
    expect(overlapsWorkedTime(paused, at(10), at(11))).toBe(true);
    expect(overlapsWorkedTime(paused, at(12), at(13))).toBe(false);
  });
});

describe('TimeEntriesService.patch — a duration nobody touched stays as it is', () => {
  // The dialog sent both ends on every save, and the duration was recomputed
  // from them: fixing a typo gave a paused timer's entry its pause back.
  it('a save that sends the window back unchanged leaves the duration alone', async () => {
    const { svc, timeEntry, row } = build();
    await svc.patch(me, 'te1', {
      description: 'fixed a typo',
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
    });
    const { data } = timeEntry.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toEqual({ description: 'fixed a typo' });
    // Nothing moved, so there was nothing to check for overlap either.
    expect(timeEntry.findMany).not.toHaveBeenCalled();
  });

  it('moving the window recomputes the duration from it, and checks it', async () => {
    const { svc, timeEntry } = build();
    await svc.patch(me, 'te1', { endTime: at(10).toISOString() });
    const { data } = timeEntry.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({ endTime: at(10), duration: 60 });
    expect(timeEntry.findMany.mock.calls[0][0].where).toMatchObject({ id: { not: 'te1' } });
  });
});

describe('TimeEntriesService — an edit and a decision racing', () => {
  // The edit read PENDING, the approval landed, and a plain update by id then
  // wrote new hours under an approval that never saw them.
  it('an edit is written only while the entry still has the status it was read with', async () => {
    const { svc, timeEntry } = build({ writes: 0 });
    await expect(svc.patch(me, 'te1', { description: 'late edit' })).rejects.toThrow(
      /while you were editing/,
    );
    expect(timeEntry.updateMany.mock.calls[0][0].where).toEqual({ id: 'te1', status: 'PENDING' });
  });
});

describe('TimeEntriesService.remove — an approved entry is kept', () => {
  it('refuses to delete an approved entry', async () => {
    const { svc, timeEntry } = build({ row: { status: 'APPROVED' } });
    await expect(svc.remove(me, 'te1')).rejects.toThrow(/signed off/);
    expect(timeEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes a pending one — conditionally, in case an approval lands first', async () => {
    const { svc, timeEntry } = build();
    await svc.remove(me, 'te1');
    expect(timeEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: 'te1', status: { not: 'APPROVED' } },
    });
  });

  it('keeps it when the approval won the race', async () => {
    const { svc } = build({ writes: 0 });
    await expect(svc.remove(me, 'te1')).rejects.toThrow(/signed off/);
  });
});
