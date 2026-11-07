import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { logger } from '@/lib/logger';
import type { LeaveRequest } from '@/types';
import {
  businessDateOf,
  countWorkingDaysInMonth,
  formatDateOnly,
  getMonthDateRange,
  getWeekOfMonth,
  getWorkingSaturdaysInMonth,
  isSaturdayWorking,
  isWeekend,
  isWorkingDay,
  parseDateOnly,
  todayDateOnly,
} from '@/lib/utils/working-days';

/**
 * Attendance Management Utilities
 * Handles check-in/check-out, work hours calculation, and attendance analytics
 *
 * All calendar-day math lives in `@/lib/utils/working-days` (local calendar
 * parts, never `toISOString()`, which shifts the day outside UTC) and is
 * re-exported here so existing attendance imports keep working.
 */

export {
  countWorkingDaysInMonth,
  getMonthDateRange,
  getWeekOfMonth,
  getWorkingSaturdaysInMonth,
  isSaturdayWorking,
  isWeekend,
  isWorkingDay,
};

// ============================================================================
// Attendance Types and Constants
// ============================================================================

export const ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  HALF_DAY: 'Half Day',
  ON_LEAVE: 'On Leave',
  WEEKEND: 'Weekend',
  HOLIDAY: 'Holiday',
} as const;

export type AttendanceStatus = keyof typeof ATTENDANCE_STATUS;

/*
 * There is deliberately no work schedule in this file. A copy of the API's
 * start time and grace period used to live here, and the Today badge graded the
 * arrival a second time from it — on the browser's clock, against hours the
 * workspace can now set for itself. Whether a day was late, and by how much, is
 * read off the record the server filed (`status`, `lateMinutes`).
 */

// ============================================================================
// Date and Time Utilities
// ============================================================================

/**
 * Get current date in YYYY-MM-DD format (the user's LOCAL calendar day)
 */
export function getCurrentDate(): string {
  return todayDateOnly();
}

/**
 * The one time-of-day format the attendance screens show: 12-hour, "09:24 PM".
 *
 * The Today card's clock was built by hand as 24-hour "21:23" while the
 * check-in right under it, and every time on the Team tab, came out of
 * `formatTime` as "09:24 PM" — two formats for the same kind of fact on one
 * card. Both read this now.
 */
const TIME_OF_DAY: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

/**
 * The current time, in the attendance screens' format (see TIME_OF_DAY).
 */
export function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', TIME_OF_DAY);
}

/** Milliseconds until the next whole minute on the clock. */
export function msUntilNextMinute(now: number = Date.now()): number {
  return 60_000 - (now % 60_000);
}

/**
 * Check if a date is today
 */
export function isToday(date: string): boolean {
  const today = getCurrentDate();
  return date === today;
}

/**
 * Format a MINUTE count as "1h 30m".
 *
 * Re-exported, not reimplemented. This module used to define its own
 * `formatMinutes` byte-identical to `formatMinutesHuman`, while
 * `@/lib/utils/time-format` exported a DIFFERENT `formatMinutes` rendering the
 * same input as "01:30" — so which format a screen showed depended on which
 * module it happened to import from, and the timesheet really did disagree with
 * the task timer. The HH:MM variant has since been deleted; durations are
 * "1h 30m" everywhere.
 */
export { formatMinutesHuman as formatMinutes } from '@/lib/utils/time-format';

/**
 * Calculate work hours between check-in and check-out.
 * Never negative or NaN: a backwards clock or an unparseable timestamp must not
 * subtract from a month's totals or render as "-2h -30m".
 */
export function calculateWorkHours(checkInTime: string, checkOutTime: string): number {
  const checkIn = new Date(checkInTime);
  const checkOut = new Date(checkOutTime);
  const hours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

// ============================================================================
// Attendance Analytics
// ============================================================================

/**
 * Calculate attendance rate percentage.
 *
 * Clamped at 100: a rate is the share of the days that COULD have been
 * attended, so it has no meaning above the whole. The numerator is already
 * restricted to countable days below — this is the belt that stops any future
 * mismatch surfacing as "167%" next to a progress bar pinned at full.
 */
function calculateAttendanceRate(
  presentDays: number,
  totalWorkingDays: number
): number {
  if (totalWorkingDays === 0) return 0;
  return Math.min(100, Math.round((presentDays / totalWorkingDays) * 100));
}

/**
 * Calculate average work hours
 */
function calculateAverageWorkHours(workHours: number[]): number {
  if (workHours.length === 0) return 0;
  const total = workHours.reduce((sum, hours) => sum + hours, 0);
  return Math.round((total / workHours.length) * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate total work hours in period
 */
function calculateTotalWorkHours(attendanceRecords: { workHours?: number }[]): number {
  return attendanceRecords.reduce((total, record) => {
    return total + (record.workHours || 0);
  }, 0);
}

/**
 * Count late arrivals
 */
function countLateArrivals(attendanceRecords: { status: string }[]): number {
  return attendanceRecords.filter(
    (record) => record.status === 'LATE' || record.status === 'Late'
  ).length;
}

/**
 * Count absences
 */
function countAbsences(attendanceRecords: { status: string }[]): number {
  return attendanceRecords.filter(
    (record) => record.status === 'ABSENT' || record.status === 'Absent'
  ).length;
}

// ============================================================================
// UI Utilities
// ============================================================================

/**
 * Get status color for UI
 */
export function getAttendanceStatusColor(status: AttendanceStatus | string): string {
  const green = 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700';
  const red = 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700';
  const orange = 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 border-orange-200 dark:border-orange-700';
  const yellow = 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-700';
  const blue = 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-700';
  const gray = 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700';
  const purple = 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 border-purple-200 dark:border-purple-700';

  const statusMap: Record<string, string> = {
    PRESENT: green,
    Present: green,
    ABSENT: red,
    Absent: red,
    LATE: orange,
    Late: orange,
    HALF_DAY: yellow,
    'Half Day': yellow,
    ON_LEAVE: blue,
    'On Leave': blue,
    WEEKEND: gray,
    Weekend: gray,
    // Nothing to report: a future date, or one before the membership began.
    UNKNOWN: gray,
    HOLIDAY: purple,
    Holiday: purple,
  };

  return statusMap[status] || gray;
}

/**
 * Get status icon glyph (matches the attendance calendar legend)
 */
export function getAttendanceStatusIcon(status: AttendanceStatus | string): string {
  const iconMap: Record<string, string> = {
    PRESENT: '✓', // check mark
    Present: '✓',
    ABSENT: '✗', // ballot X
    Absent: '✗',
    LATE: '⏰', // alarm clock
    Late: '⏰',
    HALF_DAY: '½',
    'Half Day': '½',
    ON_LEAVE: '\u{1F3D6}️', // beach with umbrella
    'On Leave': '\u{1F3D6}️',
    WEEKEND: '\u{1F4C5}', // calendar
    Weekend: '\u{1F4C5}',
    HOLIDAY: '\u{1F389}', // party popper
    Holiday: '\u{1F389}',
  };

  return iconMap[status] || '•';
}

/**
 * Format a recorded time for display — the attendance screens' one format
 * (see TIME_OF_DAY), shared with the Today card's clock.
 */
export function formatTime(dateTime: string): string {
  return new Date(dateTime).toLocaleTimeString('en-US', TIME_OF_DAY);
}

/**
 * Get greeting based on time of day
 */
export function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/**
 * Get calendar month data
 */
export function getCalendarMonth(year: number, month: number): Date[] {
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  const dates: Date[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    dates.push(new Date(year, month, day));
  }

  return dates;
}

/**
 * Get attendance summary for period
 */
export interface AttendanceSummary {
  totalDays: number;
  workingDays: number;
  /** Working days that actually required attendance (working days minus leave). */
  expectedDays: number;
  presentDays: number;
  /** Days actually attended: present + late + half days — the rate's numerator. */
  attendedDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  attendanceRate: number;
  totalWorkHours: number;
  averageWorkHours: number;
  /**
   * Days that produced an attendance row the denominator does not contain — a
   * manager-filed public holiday or non-working Saturday, or a day on approved
   * leave that was worked anyway.
   *
   * Their HOURS are in `totalWorkHours` (they really were worked) but their
   * DAYS are in none of the counts, so the "Total Work Hours" card and the
   * "Attendance Rate" card next to it describe different day sets. That is
   * deliberate, and this is the number that lets the UI say so out loud
   * instead of leaving the two figures quietly disagreeing.
   */
  uncountedDays: number;
}

/**
 * Summarize a period.
 *
 * `workingDaysInPeriod` must be the working days that have ELAPSED in the period
 * (see useAttendanceAnalytics) — using the whole month mid-month renders perfect
 * attendance as ~26%. `leaveDaysInPeriod` is the approved-leave day count: leave
 * is never persisted as an attendance row, so absences are derived rather than
 * counted from a status nothing writes. `countsTowardRate` decides which rows
 * may enter the day counts — pass the same day rule the denominator was built
 * from, or the numerator and the denominator will describe different months.
 */
export function calculateAttendanceSummary(
  attendanceRecords: Array<{
    date?: string;
    status: string;
    workHours?: number;
  }>,
  workingDaysInPeriod: number,
  leaveDaysInPeriod = 0,
  countsTowardRate?: (date: string) => boolean
): AttendanceSummary {
  // Day COUNTS may only look at rows filed on a day the denominator also
  // counted. Self-service check-in now refuses a declared public holiday, but a
  // manager may still FILE one (and a non-working Saturday, and a day already
  // covered by approved leave). All three are removed from
  // `workingDaysInPeriod`, so counting their rows in the numerator produced
  // "Attendance Rate 167% — 5 of 3 days so far this month".
  //
  // Work HOURS still come from every row: those hours really were worked, and
  // dropping them would understate the month's total. `uncountedDays` below is
  // how many days that split covers, so the UI can name the asymmetry rather
  // than let two cards quietly disagree.
  const countedRecords = countsTowardRate
    ? attendanceRecords.filter((r) => !r.date || countsTowardRate(String(r.date).slice(0, 10)))
    : attendanceRecords;

  // The excluded days that actually CONTRIBUTED HOURS, de-duplicated.
  //
  // `workHours > 0` is the whole point: this number exists only to explain why
  // the hours total and the day counts disagree, and a day with no hours creates
  // no disagreement to explain. Counting every excluded day instead made the
  // note fire for approved leave — LeaveApprovalService writes one ON_LEAVE row
  // per covered working day with `workHours` left null — so an ordinary member
  // with three days off read "Includes 3 days outside the working calendar …
  // Those hours count here" about three days that contributed exactly zero
  // hours, duplicating the leave count already shown in the Monthly Breakdown.
  // Leave is far more common than working a holiday, so the copy was wrong most
  // of the time it appeared.
  const uncountedDays = new Set(
    attendanceRecords
      .filter((r) => r.date && !countedRecords.includes(r) && (r.workHours ?? 0) > 0)
      .map((r) => String(r.date).slice(0, 10))
  ).size;

  // Count DAYS, not rows. The API's @@unique(workspace, user, date) makes the
  // two the same within one workspace, but `useAttendanceAnalytics` drops the
  // workspace predicate when it has no workspace id, and a member of two
  // workspaces then gets two rows for the same date — "4 of 3 days so far this
  // month", with the percentage only saved by its clamp. First row wins; the
  // dates cannot legitimately collide, so which one is arbitrary by definition.
  const byDay = new Map<string, (typeof countedRecords)[number]>();
  const undated: typeof countedRecords = [];
  for (const record of countedRecords) {
    const day = record.date ? String(record.date).slice(0, 10) : '';
    if (!day) undated.push(record);
    else if (!byDay.has(day)) byDay.set(day, record);
  }
  const countedDays = [...byDay.values(), ...undated];

  const presentDays = countedDays.filter(
    (r) => r.status === 'PRESENT' || r.status === 'Present'
  ).length;

  const lateDays = countLateArrivals(countedDays);

  const halfDays = countedDays.filter(
    (r) => r.status === 'HALF_DAY' || r.status === 'Half Day'
  ).length;

  // The caller's count, zero included. This used to be `leaveDaysInPeriod ||
  // <every ON_LEAVE row in the month>`, which took a zero for "not given" — so
  // leave approved for the END of the month was subtracted from the days
  // already gone, and five attended days out of ten read as "100% — 5 of 5".
  const leaveDays = leaveDaysInPeriod;

  const attendedDays = presentDays + lateDays + halfDays;
  const expectedDays = Math.max(0, workingDaysInPeriod - leaveDays);
  const absentDays = Math.max(countAbsences(countedDays), expectedDays - attendedDays);

  const totalWorkHours = calculateTotalWorkHours(attendanceRecords);
  const workHoursArray = attendanceRecords
    .filter((r) => r.workHours && r.workHours > 0)
    .map((r) => r.workHours!);
  const averageWorkHours = calculateAverageWorkHours(workHoursArray);

  return {
    // Distinct days with a row, for the same reason the counts above are:
    // rows and days are only interchangeable inside one workspace.
    totalDays: new Set(
      attendanceRecords.map((r, i) => (r.date ? String(r.date).slice(0, 10) : `#${i}`))
    ).size,
    workingDays: workingDaysInPeriod,
    expectedDays,
    presentDays,
    attendedDays,
    absentDays,
    lateDays,
    halfDays,
    leaveDays,
    attendanceRate: calculateAttendanceRate(attendedDays, expectedDays),
    totalWorkHours: Math.round(totalWorkHours * 10) / 10,
    averageWorkHours,
    uncountedDays,
  };
}

// ============================================================================
// Leave Integration
// ============================================================================

/**
 * Get all approved leave dates for a user in a date range
 * @param userId - User id
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param workspaceId - Workspace to read leave in. REQUIRED to read anyone but
 *   yourself: the server scopes leave reads to the caller unless the request
 *   names a workspace where the caller holds `leave:approve`. It also keeps the
 *   result to one workspace, so a multi-workspace member's leave from elsewhere
 *   cannot leak into this workspace's attendance denominator.
 * @returns Promise<Set<string>> - Set of dates user is on leave
 */
export async function getUserLeaveDates(
  userId: string,
  startDate: string,
  endDate: string,
  workspaceId?: string
): Promise<Set<string>> {
  if (!userId || !startDate || !endDate) return new Set();

  try {
    // Query for all approved leaves that overlap with the date range. The date
    // predicates reach Prisma (both are on the leave resource's filter
    // allowlist); listAll still walks the pages because a long-running leave
    // history can exceed one page, and the clamp below keeps only the days
    // inside [startDate, endDate].
    const response = await resources.listAll<LeaveRequest>('leave_requests', [
      query.equal('userId', userId),
      query.equal('status', 'APPROVED'),
      // Leave overlaps if: leave.startDate <= endDate AND leave.endDate >= startDate
      query.lessThanEqual('startDate', endDate),
      query.greaterThanEqual('endDate', startDate),
      ...(workspaceId ? [query.equal('workspaceId', workspaceId)] : []),
    ]
    );

    const leaveDates = new Set<string>();

    // For each approved leave, add all dates in the range — but not a half
    // day's: the person works the other half and checks in for it, and the API
    // files no ON_LEAVE day for one (materializeLeaveAttendance).
    response.items.forEach((leave) => {
      if (leave.type === 'HALF_DAY') return;
      const leaveStart = parseDateOnly(String(leave.startDate));
      const leaveEnd = parseDateOnly(String(leave.endDate));
      const rangeStart = parseDateOnly(startDate);
      const rangeEnd = parseDateOnly(endDate);

      // Get the actual start and end dates within our query range
      const actualStart = leaveStart > rangeStart ? leaveStart : rangeStart;
      const actualEnd = leaveEnd < rangeEnd ? leaveEnd : rangeEnd;

      // Add each date in the leave period
      const currentDate = new Date(actualStart);
      while (currentDate <= actualEnd) {
        leaveDates.add(formatDateOnly(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return leaveDates;
  } catch (error) {
    logger.error('Error fetching leave dates', { error });
    return new Set();
  }
}



/**
 * The first day on which a person's absence could be meaningful.
 *
 * A day before somebody joined the workspace is not a day they failed to
 * attend — there was nothing to attend. Without this boundary every screen that
 * infers "working day + no record ⇒ absent" painted a new member's entire
 * history red: a user who joined on 5 September read the whole of August as 23
 * missed days, and the analytics denominator counted those days too, so their
 * attendance rate opened at a fraction of what they had actually achieved.
 *
 * Returns the LATER of the period start and the membership start, both as
 * `YYYY-MM-DD` day markers, so callers can use it directly as a lower bound.
 */
export function attendanceWindowStart(periodStart: string, joinedAt?: string): string {
  if (!joinedAt) return periodStart;
  // The business day the membership began, not the UTC date the timestamp
  // starts with — they differ for hours of every day (see businessDateOf).
  const joinedDay = businessDateOf(String(joinedAt));
  // A malformed value must not silently widen the window back to the epoch.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinedDay)) return periodStart;
  return joinedDay > periodStart ? joinedDay : periodStart;
}
