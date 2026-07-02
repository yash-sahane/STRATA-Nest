/**
 * Server-side attendance computation — ported faithfully from the frontend
 * `attendance-utils.ts` (D9: rules move server-side). Reconciliation caveat:
 * the frontend used the browser's local timezone for the 08:30 comparison; the
 * server uses its own TZ. Align WORK_TZ before flipping the source of truth.
 */
export const WORK_SCHEDULE = {
  START_MINUTES: 8 * 60 + 30, // 08:30
  GRACE_MINUTES: 15,
  HALF_DAY_HOURS: 4,
  ALTERNATE_SATURDAY_WEEKS: [1, 3],
};

/** Hours between check-in and check-out (calculateWorkHours). */
export function calculateWorkHours(checkIn: Date, checkOut: Date): number {
  return (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function isLateCheckIn(checkIn: Date): boolean {
  return minutesOfDay(checkIn) > WORK_SCHEDULE.START_MINUTES + WORK_SCHEDULE.GRACE_MINUTES;
}

export function calculateLateMinutes(checkIn: Date): number {
  const diff = minutesOfDay(checkIn) - WORK_SCHEDULE.START_MINUTES;
  return diff > 0 ? diff : 0;
}

/** determineAttendanceStatus → one of PRESENT | LATE | HALF_DAY | ABSENT. */
export function determineAttendanceStatus(
  checkIn: Date | null,
  checkOut: Date | null,
  workHours: number | null,
): string {
  if (!checkIn) return 'ABSENT';
  if (isLateCheckIn(checkIn)) {
    if (!checkOut || workHours == null) return 'LATE';
    return workHours < WORK_SCHEDULE.HALF_DAY_HOURS ? 'HALF_DAY' : 'LATE';
  }
  if (checkOut && workHours != null && workHours < WORK_SCHEDULE.HALF_DAY_HOURS) return 'HALF_DAY';
  return 'PRESENT';
}

function weekOfMonth(d: Date): number {
  const firstDayOfWeek = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return Math.ceil((d.getDate() + firstDayOfWeek) / 7);
}

/** isWeekend: Sunday always; Saturday except on alternate working weeks (1 & 3). */
export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  if (day === 0) return true;
  if (day === 6) return !WORK_SCHEDULE.ALTERNATE_SATURDAY_WEEKS.includes(weekOfMonth(d));
  return false;
}
