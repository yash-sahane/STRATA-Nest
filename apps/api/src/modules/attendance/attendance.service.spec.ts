import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '@strata/prisma';
import type { Attendance, User } from '@prisma/client';
import { Permission } from '../authz/permissions';
import type { WorkspaceAccessService } from '../authz/workspace-access.service';
import { AttendanceService } from './attendance.services';

/**
 * Attendance is payroll-adjacent personal data and `hr:write` is in the member
 * baseline, so the row's subject must come from the caller — never the body —
 * and a plain member must not be able to read or resolve a colleague's record.
 */
describe('AttendanceService — per-user scoping', () => {
  const member = { id: 'user-MEMBER', name: 'Member' } as User;
  const manager = { id: 'user-MANAGER', name: 'Manager' } as User;
  const colleague = 'user-COLLEAGUE';

  const row = {
    id: 'att-1',
    workspaceId: 'w1',
    userId: colleague,
    date: new Date('2026-08-08T00:00:00.000Z'),
    checkInTime: new Date('2026-08-08T03:00:00.000Z'),
    checkOutTime: null,
    workHours: null,
    status: 'PRESENT',
    lateMinutes: 0,
    location: '',
    notes: '',
    isWeekend: false,
    isHoliday: false,
    createdById: colleague,
    createdByName: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Attendance;

  function build(opts: { isManager?: boolean } = {}) {
    const attendance = {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data })),
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue(row),
    };
    // create/checkIn consult the workspace calendar so the row's isHoliday flag
    // describes the day rather than repeating the caller's claim about it.
    const holiday = { findFirst: jest.fn().mockResolvedValue(null) };
    const prisma = { attendance, holiday } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      scopeWhere: jest.fn().mockResolvedValue({}),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      can: jest.fn().mockResolvedValue(opts.isManager ?? false),
    } as unknown as WorkspaceAccessService;
    return { svc: new AttendanceService(prisma, access), attendance, access, holiday };
  }

  it('create: stamps the caller as the subject and the audit trail', async () => {
    // Filing by hand is an HR correction now, so the caller is a manager.
    const { svc, attendance } = build({ isManager: true });
    await svc.create(manager, {
      workspaceId: 'w1',
      date: '2026-08-08',
      checkInTime: '2026-08-08T03:00:00.000Z',
    });
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.userId).toBe(manager.id);
    expect(data.createdById).toBe(manager.id);
  });

  it('create: a plain member cannot file attendance by hand at all', async () => {
    // hr:write is in the member baseline, so without the manager gate any member
    // could POST a Sunday with 9 hours, or a date 15 months out, and the
    // calendar, the manager Team tab and the analytics rate rendered it as fact.
    const { svc, attendance, access } = build();
    (access.assertPermission as jest.Mock).mockRejectedValueOnce(new ForbiddenException());
    await expect(
      svc.create(member, {
        workspaceId: 'w1',
        date: '2026-08-08',
        checkInTime: '2026-08-08T03:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attendance.create).not.toHaveBeenCalled();
  });

  it('create: derives the figures rather than trusting them', async () => {
    const { svc, attendance } = build({ isManager: true });
    await svc.create(manager, {
      workspaceId: 'w1',
      date: '2026-08-08',
      checkInTime: '2026-08-08T03:00:00.000Z',
      checkOutTime: '2026-08-08T03:30:00.000Z',
      // every one of these is a claim the row must NOT simply adopt
      workHours: 24,
      lateMinutes: 0,
      isWeekend: false,
    } as never);
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.workHours).toBeCloseTo(0.5, 1);
    expect(data.isWeekend).toBe(true); // 2026-08-08 is a week-2 Saturday
  });

  it('create: refuses a check-out that precedes the check-in', async () => {
    const { svc, attendance } = build({ isManager: true });
    await expect(
      svc.create(manager, {
        workspaceId: 'w1',
        date: '2026-08-07',
        checkInTime: '2026-08-07T09:00:00.000Z',
        checkOutTime: '2026-08-07T08:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attendance.create).not.toHaveBeenCalled();
  });

  it('create: refuses a date in the future', async () => {
    const { svc, attendance } = build({ isManager: true });
    const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await expect(
      svc.create(manager, {
        workspaceId: 'w1',
        date: future,
        checkInTime: future + 'T03:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attendance.create).not.toHaveBeenCalled();
  });

  it('create: a member cannot file attendance for a colleague', async () => {
    const { svc, attendance } = build();
    await expect(
      svc.create(member, {
        workspaceId: 'w1',
        userId: colleague,
        date: '2026-08-08',
        checkInTime: '2026-08-08T03:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(attendance.create).not.toHaveBeenCalled();
  });

  it('create: an HR manager may file attendance for a colleague', async () => {
    const { svc, attendance, access } = build({ isManager: true });
    await svc.create(manager, {
      workspaceId: 'w1',
      userId: colleague,
      date: '2026-08-08',
      checkInTime: '2026-08-08T03:00:00.000Z',
    });
    expect(access.can).toHaveBeenCalledWith(manager, 'w1', Permission.LeaveApprove);
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.userId).toBe(colleague);
  });

  it('create: a day worked on a public holiday is filed, flagged, and never LATE', async () => {
    // Somebody who came in on a shut day must not lose the day — and must not
    // be marked LATE for it either: a holiday has no expected start, so grading
    // a 15:00 arrival against 08:30 invented 391 minutes of lateness on a day
    // nobody was asked to be in. The flag is what keeps the row out of the
    // attendance rate's denominator AND its numerator.
    const { svc, attendance, holiday } = build({ isManager: true });
    holiday.findFirst.mockResolvedValueOnce({ name: 'QA Founders Day' });
    // Local wall clock: lateness is a time-of-day rule (see attendance-compute).
    await svc.create(manager, {
      workspaceId: 'w1',
      date: '2026-08-07',
      checkInTime: new Date(2026, 7, 7, 15, 0, 0).toISOString(),
    });
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.isHoliday).toBe(true);
    expect(data.lateMinutes).toBe(0);
    expect(data.status).toBe('PRESENT');
  });

  it('list: a member is forced to their own rows (spoofed userId filter ignored)', async () => {
    const { svc, attendance } = build();
    await svc.list(member, { workspaceId: 'w1', userId: colleague });
    const call = attendance.findMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
    expect(call.where.AND[1]).toEqual({ workspaceId: 'w1', userId: member.id });
  });

  it('list: a suffixed userId filter cannot widen the scope back out', async () => {
    // parseListQuery treats `userId__ne` as a SEPARATE key that lands on the
    // same `where.userId`, last-one-wins. Overwriting the plain `userId` key
    // left the negation in place, turning a member's own attendance list into
    // the whole workspace's — check-in/out times, late minutes and the ON_LEAVE
    // markers that reveal who is on leave.
    const { svc, attendance } = build();
    await svc.list(member, {
      workspaceId: 'w1',
      userId: member.id,
      userId__ne: '__none__',
      userId__in: `${colleague},${member.id}`,
    });
    const call = attendance.findMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
    expect(call.where.AND[1]).toEqual({ workspaceId: 'w1', userId: member.id });
  });

  it('list: an HR manager sees the whole workspace', async () => {
    const { svc, attendance } = build({ isManager: true });
    await svc.list(manager, { workspaceId: 'w1' });
    const call = attendance.findMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } };
    expect(call.where.AND[1]).toEqual({ workspaceId: 'w1' });
  });

  it('retrieve/update/remove: a member cannot touch a colleague’s record', async () => {
    const { svc, attendance } = build();
    await expect(svc.retrieve(member, 'att-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.patch(member, 'att-1', { status: 'ABSENT' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(member, 'att-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(attendance.update).not.toHaveBeenCalled();
    expect(attendance.delete).not.toHaveBeenCalled();
  });
});

/**
 * There is one attendance row per (workspace, user, day). A second check-in must
 * be refused with a message the user can act on — never fall through to the
 * @@unique constraint, which surfaces as the generic "A record with these values
 * already exists.".
 */
describe('AttendanceService.checkIn — duplicate guard', () => {
  const member = { id: 'user-MEMBER', name: 'Member' } as User;

  function build(existing: Partial<Attendance> | null, closedHoliday: { name: string } | null = null) {
    const attendance = {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          checkOutTime: null,
          workHours: null,
          isHoliday: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }),
      ),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          checkOutTime: null,
          workHours: null,
          isHoliday: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...existing,
          ...data,
        }),
      ),
    };
    const holiday = { findFirst: jest.fn().mockResolvedValue(closedHoliday) };
    const prisma = { attendance, holiday } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      can: jest.fn().mockResolvedValue(false),
    } as unknown as WorkspaceAccessService;
    return { svc: new AttendanceService(prisma, access), attendance, holiday };
  }

  it('creates the row when nothing exists for today', async () => {
    const { svc, attendance } = build(null);
    const res = await svc.checkIn(member, { workspaceId: 'w1' });
    expect(attendance.create).toHaveBeenCalled();
    expect(res.userId).toBe(member.id);
  });

  it('refuses a second check-in while still checked in', async () => {
    const { svc, attendance } = build({ id: 'att-1', checkOutTime: null } as Attendance);
    await expect(svc.checkIn(member, { workspaceId: 'w1' })).rejects.toThrow(
      new BadRequestException('Already checked in today'),
    );
    expect(attendance.create).not.toHaveBeenCalled();
  });

  it('refuses a check-in after the day was already checked out', async () => {
    const { svc, attendance } = build({
      id: 'att-1',
      checkOutTime: new Date('2026-08-08T12:00:00.000Z'),
    } as Attendance);
    await expect(svc.checkIn(member, { workspaceId: 'w1' })).rejects.toThrow(
      new BadRequestException('You have already completed attendance for today'),
    );
    expect(attendance.create).not.toHaveBeenCalled();
  });

  /**
   * Approving leave writes an ON_LEAVE marker row per covered working day. That
   * is not a check-in, so a member who comes in anyway must not be told they
   * have "already checked in today" — leave that has already started cannot be
   * cancelled, so the refusal would be inescapable.
   */
  it('converts an ON_LEAVE marker into a real check-in instead of refusing', async () => {
    const { svc, attendance } = build({
      id: 'att-1',
      status: 'ON_LEAVE',
      // The marker pins checkInTime to the day marker itself — there is no real
      // arrival time to record until someone actually turns up.
      date: new Date('2026-08-08T00:00:00.000Z'),
      checkInTime: new Date('2026-08-08T00:00:00.000Z'),
      checkOutTime: null,
      notes: 'Approved CASUAL leave',
    } as unknown as Attendance);

    const res = await svc.checkIn(member, { workspaceId: 'w1', notes: 'Came in anyway' });

    expect(attendance.create).not.toHaveBeenCalled();
    const call = attendance.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(call.where.id).toBe('att-1');
    expect(['PRESENT', 'LATE']).toContain(call.data.status);
    expect(call.data.checkInTime).toBeInstanceOf(Date);
    // The leave note survives as the audit trail for why the row existed.
    expect(call.data.notes).toBe('Approved CASUAL leave\nCame in anyway');
    expect(res.status).not.toBe('ON_LEAVE');
  });

  /**
   * A declared public holiday LABELS the day; it does not veto the check-in.
   *
   * Refusing it (which is what this used to do) left an employee who worked the
   * holiday with no way to record it at all — self-service check-in is their
   * only path, and manual filing is HR-manager-only. What actually needed
   * fixing was the figures: the arrival was graded LATE against an 08:30 start
   * nobody was expected to make, on a day the analytics denominator does not
   * count. So the row is written, stamped, and not marked against a clock the
   * office was not keeping.
   */
  it('records a check-in on a declared public holiday as holiday work', async () => {
    const { svc, attendance } = build(null, { name: 'QA Founders Day' });
    const res = await svc.checkIn(member, { workspaceId: 'w1' });
    expect(attendance.create).toHaveBeenCalled();
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.isHoliday).toBe(true);
    expect(data.lateMinutes).toBe(0);
    expect(data.status).toBe('PRESENT');
    expect(res.status).toBe('PRESENT');
  });

  it('stamps isHoliday when it converts an ON_LEAVE marker on a holiday', async () => {
    // Approval materialises markers without consulting the calendar, so an
    // ON_LEAVE row CAN sit on a holiday with the flag still false. Converting
    // it into a real attendance row has to correct that, or the day lands in
    // the counts a holiday is supposed to stay out of.
    const { svc, attendance } = build(
      {
        id: 'att-1',
        status: 'ON_LEAVE',
        date: new Date('2026-08-08T00:00:00.000Z'),
        checkInTime: new Date('2026-08-08T00:00:00.000Z'),
        checkOutTime: null,
      } as unknown as Attendance,
      { name: 'QA Founders Day' },
    );
    await svc.checkIn(member, { workspaceId: 'w1' });
    const { data } = attendance.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.isHoliday).toBe(true);
    expect(data.lateMinutes).toBe(0);
    expect(data.status).toBe('PRESENT');
  });

  it('ignores an OPTIONAL holiday — the office is open, so check-in works', async () => {
    // A restricted holiday is an ordinary working day that a member may choose
    // to spend as leave. `holidaysIn` on the leave side and `useHolidays` in
    // the browser both filter `isOptional: false`; the calendar lookup here has
    // to ask the same question or the two disagree about what a working day is.
    const { svc, attendance, holiday } = build(null);
    await svc.checkIn(member, { workspaceId: 'w1' });
    expect(holiday.findFirst.mock.calls[0][0].where).toMatchObject({ isOptional: false });
    expect(attendance.create).toHaveBeenCalled();
    const { data } = attendance.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.isHoliday).toBe(false);
  });

  it('still refuses when the ON_LEAVE day was already checked out', async () => {
    const { svc, attendance } = build({
      id: 'att-1',
      status: 'ON_LEAVE',
      checkOutTime: new Date('2026-08-08T12:00:00.000Z'),
    } as unknown as Attendance);
    await expect(svc.checkIn(member, { workspaceId: 'w1' })).rejects.toThrow(
      new BadRequestException('You have already completed attendance for today'),
    );
    expect(attendance.update).not.toHaveBeenCalled();
  });
});

/**
 * The mirror of the checkIn case above. An ON_LEAVE marker IS today's row and
 * carries a non-null `checkInTime` pinned to the day marker with no check-out,
 * so a bare "row exists && not checked out" test let someone check out at 17:00
 * without ever checking in: `calculateWorkHours` measured from UTC midnight and
 * credited a full day of work for a day spent on leave, while the rewrite to
 * PRESENT/LATE destroyed the marker the team view renders and `cancel` deletes
 * by — leaving the record and the deducted balance disagreeing.
 */
describe('AttendanceService.checkOut — leave markers are not open check-ins', () => {
  const member = { id: 'user-MEMBER', name: 'Member' } as User;
  const day = new Date('2026-08-08T00:00:00.000Z');

  function build(existing: Partial<Attendance> | null) {
    const attendance = {
      findFirst: jest.fn().mockResolvedValue(existing),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...existing, ...data, createdAt: new Date(), updatedAt: new Date() }),
        ),
    };
    const holiday = { findFirst: jest.fn().mockResolvedValue(null) };
    const prisma = { attendance, holiday } as unknown as PrismaService;
    const access = {
      assertPermission: jest.fn().mockResolvedValue(undefined),
      isPlatformAdmin: jest.fn().mockReturnValue(false),
      can: jest.fn().mockResolvedValue(false),
    } as unknown as WorkspaceAccessService;
    return { svc: new AttendanceService(prisma, access), attendance };
  }

  it('refuses to check out against an ON_LEAVE marker', async () => {
    const { svc, attendance } = build({
      id: 'att-1',
      status: 'ON_LEAVE',
      date: day,
      checkInTime: day, // the marker, not an arrival time
      checkOutTime: null,
    } as unknown as Attendance);
    await expect(svc.checkOut(member, { workspaceId: 'w1' })).rejects.toThrow(
      new BadRequestException('Not checked in today'),
    );
    expect(attendance.update).not.toHaveBeenCalled();
  });

  it('still checks out a real check-in on the same day', async () => {
    const { svc, attendance } = build({
      id: 'att-1',
      status: 'PRESENT',
      date: day,
      checkInTime: new Date('2026-08-08T03:30:00.000Z'),
      checkOutTime: null,
      notes: '',
    } as unknown as Attendance);
    await svc.checkOut(member, { workspaceId: 'w1' });
    const call = attendance.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.checkOutTime).toBeInstanceOf(Date);
    expect(typeof call.data.workHours).toBe('number');
  });
});
