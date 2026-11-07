import { minutesOfDayIn, type WorkSchedule } from '@strata/config';

/**
 * Server-side attendance computation (late minutes, work hours, status).
 *
 * Two clocks, deliberately kept apart:
 *  - TIME-OF-DAY rules (isLateCheckIn / calculateLateMinutes) read a wall clock
 *    off a real instant: the OFFICE's, when they are handed the workspace's
 *    schedule, which is how the service calls them. Without one they fall back
 *    to the server's local clock and the default hours below — what they always
 *    did, before a workspace could declare its own.
 *  - DAY rules (isWeekend / weekOfMonth) read UTC parts off a date-only DAY
 *    MARKER — `Attendance.date` is a @db.Date column stored at UTC midnight, and
 *    reading its local parts shifts it to the previous day west of UTC.
 * Pass instants to the first group and day markers to the second; never swap.
 */
export const WORK_SCHEDULE = {
  /** Defaults only — a workspace's own start and grace period override these
   *  (`workScheduleOf` in @strata/config). */
  START_MINUTES: 8 * 60 + 30, // 08:30
  GRACE_MINUTES: 15,
  HALF_DAY_HOURS: 4,
  /**
   * Floor below which a CLOSED day earns no credit at all. `workHours < 4`
   * has no lower bound, so `0 < 4` held and checking in then immediately out
   * credited a full HALF_DAY — the cheapest possible way to fake a present
   * day. Under an hour on the clock is not half a day's work.
   */
  MIN_CREDIT_HOURS: 1,
  ALTERNATE_SATURDAY_WEEKS: [1, 3],
};

/** Hours between check-in and check-out (never negative — a backwards clock
 *  must not subtract from anyone's totals). */
export function calculateWorkHours(checkIn: Date, checkOut: Date): number {
  const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

function minutesOfDay(d: Date, schedule?: WorkSchedule): number {
  return schedule ? minutesOfDayIn(d, schedule.timeZone) : d.getHours() * 60 + d.getMinutes();
}

/** The minute of the day after which an arrival is late. */
function lateAfter(schedule?: WorkSchedule): number {
  return schedule
    ? schedule.startMinutes + schedule.graceMinutes
    : WORK_SCHEDULE.START_MINUTES + WORK_SCHEDULE.GRACE_MINUTES;
}

export function isLateCheckIn(checkIn: Date, schedule?: WorkSchedule): boolean {
  return minutesOfDay(checkIn, schedule) > lateAfter(schedule);
}

/** Minutes late, measured from the END of the grace period so that "is late"
 *  and "how late" can never contradict each other. */
export function calculateLateMinutes(checkIn: Date, schedule?: WorkSchedule): number {
  const diff = minutesOfDay(checkIn, schedule) - lateAfter(schedule);
  return diff > 0 ? diff : 0;
}

/** determineAttendanceStatus → PRESENT | LATE | HALF_DAY | ABSENT | HOLIDAY.
 *
 *  A day is only classified once it is CLOSED (both stamps present). An
 *  open day reports on the check-in alone; a closed day under
 *  MIN_CREDIT_HOURS earns nothing, because the member was not there. */
export function determineAttendanceStatus(
  checkIn: Date | null,
  checkOut: Date | null,
  workHours: number | null,
  /**
   * Whether the day HAD an expected start time. A day the office was shut — a
   * declared public holiday, a Sunday, a non-working Saturday — has none, so
   * nothing done on it can be "late": measuring a 15:00 holiday arrival against
   * the 08:30 schedule is what filed holiday work as LATE by hours on a day
   * nobody was asked to be in. Such a day is still recorded, just graded on
   * hours alone.
   */
  expectsPunctuality = true,
  /** The office's hours. Omitted, the defaults on the server's own clock. */
  schedule?: WorkSchedule,
): string {
  // Nobody was expected in, so nobody failed to turn up. A shut day with no
  // stamps at all is not an absence either — the calendar and the Team tab
  // already read the closed-day flags and render it as such.
  if (!checkIn) return expectsPunctuality ? 'ABSENT' : 'HOLIDAY';
  const closed = Boolean(checkOut) && workHours != null;
  // Checked in and straight back out: no credit on either branch below. On a
  // shut day that is still not an absence — see the note above — so the floor
  // records the day as closed rather than as a day the member missed.
  if (closed && (workHours as number) < WORK_SCHEDULE.MIN_CREDIT_HOURS) {
    return expectsPunctuality ? 'ABSENT' : 'HOLIDAY';
  }
  if (expectsPunctuality && isLateCheckIn(checkIn, schedule)) {
    if (!closed) return 'LATE';
    return (workHours as number) < WORK_SCHEDULE.HALF_DAY_HOURS ? 'HALF_DAY' : 'LATE';
  }
  if (closed && (workHours as number) < WORK_SCHEDULE.HALF_DAY_HOURS) return 'HALF_DAY';
  return 'PRESENT';
}

/** 1-based week of the month for a date-only DAY MARKER (UTC accessors — see the
 *  file header). Local accessors would move a marker near either month boundary
 *  into the neighbouring week and flip the alternate-Saturday rule. */
export function weekOfMonth(d: Date): number {
  const firstDayOfWeek = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getUTCDay();
  return Math.ceil((d.getUTCDate() + firstDayOfWeek) / 7);
}

/** isWeekend: Sunday always; Saturday except on alternate working weeks (1 & 3).
 *  Takes a date-only DAY MARKER (UTC midnight), not a wall-clock instant. */
export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0) return true;
  if (day === 6) return !WORK_SCHEDULE.ALTERNATE_SATURDAY_WEEKS.includes(weekOfMonth(d));
  return false;
}
