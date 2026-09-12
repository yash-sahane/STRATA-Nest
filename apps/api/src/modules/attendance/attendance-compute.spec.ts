import {
  calculateLateMinutes,
  calculateWorkHours,
  determineAttendanceStatus,
  isLateCheckIn,
  isWeekend,
  weekOfMonth,
} from './attendance-compute';

// Local-time Date at a given hour:minute (compute uses getHours/getMinutes).
const at = (h: number, m: number): Date => new Date(2026, 5, 15, h, m, 0);

describe('attendance-compute (ported from frontend attendance-utils)', () => {
  it('isLateCheckIn: late only after 08:30 + 15m grace', () => {
    expect(isLateCheckIn(at(8, 30))).toBe(false);
    expect(isLateCheckIn(at(8, 45))).toBe(false); // boundary
    expect(isLateCheckIn(at(8, 46))).toBe(true);
  });

  it('calculateLateMinutes measured from 08:30 + 15m grace (agrees with isLateCheckIn)', () => {
    expect(calculateLateMinutes(at(8, 20))).toBe(0);
    expect(calculateLateMinutes(at(8, 30))).toBe(0);
    expect(calculateLateMinutes(at(8, 40))).toBe(0); // inside the grace period
    expect(calculateLateMinutes(at(8, 45))).toBe(0); // boundary
    expect(calculateLateMinutes(at(8, 46))).toBe(1);
    expect(calculateLateMinutes(at(10, 0))).toBe(75);
  });

  it('calculateWorkHours', () => {
    expect(calculateWorkHours(at(9, 0), at(17, 0))).toBe(8);
    expect(calculateWorkHours(at(9, 0), at(12, 30))).toBe(3.5);
    expect(calculateWorkHours(at(17, 0), at(9, 0))).toBe(0); // backwards clock → never negative
  });

  it('determineAttendanceStatus', () => {
    expect(determineAttendanceStatus(null, null, null)).toBe('ABSENT');
    expect(determineAttendanceStatus(at(8, 30), at(17, 0), 8)).toBe('PRESENT'); // on time
    expect(determineAttendanceStatus(at(8, 30), at(11, 0), 2)).toBe('HALF_DAY'); // on time, < 4h
    expect(determineAttendanceStatus(at(10, 0), null, null)).toBe('LATE'); // late, not checked out
    expect(determineAttendanceStatus(at(10, 0), at(17, 0), 7)).toBe('LATE'); // late, full-ish day
    expect(determineAttendanceStatus(at(10, 0), at(12, 0), 2)).toBe('HALF_DAY'); // late + short
  });

  it('a closed day under MIN_CREDIT_HOURS earns nothing, on either branch', () => {
    // `workHours < HALF_DAY_HOURS` had no lower bound, so 0 < 4 held and check
    // in -> check out in the same breath was credited as HALF_DAY.
    expect(determineAttendanceStatus(at(9, 0), at(9, 0), 0)).toBe('ABSENT');
    expect(determineAttendanceStatus(at(9, 0), at(9, 1), 0.017)).toBe('ABSENT');
    expect(determineAttendanceStatus(at(10, 0), at(10, 0), 0)).toBe('ABSENT'); // late + instant
    // A backwards clock clamps to 0 hours and must not become a half day either.
    expect(determineAttendanceStatus(at(17, 0), at(9, 0), 0)).toBe('ABSENT');
    // The floor is exclusive: exactly an hour still counts.
    expect(determineAttendanceStatus(at(9, 0), at(10, 0), 1)).toBe('HALF_DAY');
  });

  it('an OPEN day is never downgraded by the floor — 0 hours means "still here"', () => {
    expect(determineAttendanceStatus(at(8, 30), null, 0)).toBe('PRESENT');
    expect(determineAttendanceStatus(at(10, 0), null, 0)).toBe('LATE');
  });

  it('a day the office was SHUT has no expected start, so it is never LATE', () => {
    // Holiday and weekend work is recorded rather than refused, and the row
    // carries isHoliday/isWeekend to say so. Grading it against the 08:30
    // schedule anyway filed a 15:00 holiday arrival as LATE by 391 minutes on a
    // day nobody was asked to be in. The hours still decide everything else.
    expect(determineAttendanceStatus(at(15, 0), null, null, false)).toBe('PRESENT');
    expect(determineAttendanceStatus(at(15, 0), at(23, 0), 8, false)).toBe('PRESENT');
    expect(determineAttendanceStatus(at(15, 0), at(17, 0), 2, false)).toBe('HALF_DAY');
    // The credit floor still denies credit, but it no longer records a miss:
    // see the closed-day absence test below.
    expect(determineAttendanceStatus(at(15, 0), at(15, 10), 0.17, false)).toBe('HOLIDAY');
    // Default is unchanged: an ordinary working day is still graded on arrival.
    expect(determineAttendanceStatus(at(15, 0), null, null)).toBe('LATE');
  });

  it('a day the office was SHUT can never produce an ABSENCE', () => {
    // Measured against the live API: a manager filed two minutes of Saturday
    // work for a developer and got back
    //   { workHours: 0.033, status: 'ABSENT', isWeekend: true }
    // so the Team tab's absentCount included the day and the calendar painted
    // that Saturday red — against the person who had volunteered to work it.
    // Nobody was expected in, so nobody failed to turn up.
    for (const hours of [0, 0.01, 0.17, 0.5, 0.99]) {
      // jest's expect takes no message argument; the loop value is in the
      // failure diff via the inputs.
      expect(determineAttendanceStatus(at(15, 0), at(15, 30), hours, false)).toBe('HOLIDAY');
    }
    // A shut day with no stamps at all is not an absence either.
    expect(determineAttendanceStatus(null, null, null, false)).toBe('HOLIDAY');

    // The same inputs on a WORKING day are still absences — the floor keeps its
    // original job of refusing credit for a check-in-and-straight-out day.
    for (const hours of [0, 0.01, 0.17, 0.5, 0.99]) {
      // jest's expect takes no message argument; the loop value is in the
      // failure diff via the inputs.
      expect(determineAttendanceStatus(at(8, 30), at(9, 0), hours, true)).toBe('ABSENT');
    }
    expect(determineAttendanceStatus(null, null, null, true)).toBe('ABSENT');

    // Exactly at the floor is credited, on either kind of day.
    expect(determineAttendanceStatus(at(15, 0), at(16, 0), 1, false)).toBe('HALF_DAY');
    expect(determineAttendanceStatus(at(8, 30), at(9, 30), 1, true)).toBe('HALF_DAY');
  });
});

/**
 * `Attendance.date` is a date-only DAY MARKER stored at UTC midnight, so the
 * day-level rules must read UTC parts. Pinned in a west-of-UTC zone, where the
 * previous local-part implementation read every marker as the PREVIOUS day:
 * Saturday 08 Aug (a non-working week-2 Saturday) became Friday, Monday 10 Aug
 * became Sunday, and the 1st of the month fell into the previous month's week 5,
 * flipping the alternate-Saturday rule.
 */
describe('attendance-compute — day rules are UTC (TZ boundary)', () => {
  // Read before any mutation: TZ is unset on most machines, so restoring means
  // naming the resolved zone rather than deleting the variable.
  const ORIGINAL_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  /** A date-only day marker, exactly as Prisma hands back a @db.Date column. */
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('weekOfMonth keys off the marker’s own month, not the previous local day', () => {
    // 01 Aug 2026 is a Saturday; local parts would place it in July's week 5.
    expect(weekOfMonth(day('2026-08-01'))).toBe(1);
    expect(weekOfMonth(day('2026-08-08'))).toBe(2);
    expect(weekOfMonth(day('2026-08-15'))).toBe(3);
    expect(weekOfMonth(day('2026-08-22'))).toBe(4);
  });

  it('isWeekend: Saturdays of weeks 1 and 3 are working days, the rest are off', () => {
    expect(isWeekend(day('2026-08-01'))).toBe(false); // week 1 Saturday — working
    expect(isWeekend(day('2026-08-08'))).toBe(true); // week 2 Saturday — off
    expect(isWeekend(day('2026-08-15'))).toBe(false); // week 3 Saturday — working
    expect(isWeekend(day('2026-08-22'))).toBe(true); // week 4 Saturday — off
    expect(isWeekend(day('2026-08-29'))).toBe(true); // week 5 Saturday — off
  });

  it('isWeekend: Sunday is always off and Monday is never off', () => {
    expect(isWeekend(day('2026-08-09'))).toBe(true); // Sunday
    expect(isWeekend(day('2026-08-10'))).toBe(false); // Monday (read locally: Sunday)
  });

  it('isWeekend depends only on the UTC day, not the instant within it', () => {
    for (const iso of ['2026-08-08', '2026-08-09', '2026-08-10']) {
      const start = isWeekend(day(iso));
      expect(isWeekend(new Date(`${iso}T12:00:00.000Z`))).toBe(start);
      expect(isWeekend(new Date(`${iso}T23:59:59.999Z`))).toBe(start);
    }
  });
});
