import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { logger } from '@/lib/logger';
import {
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

// Work schedule configuration
export const WORK_SCHEDULE = {
  START_TIME: '08:30', // 8:30 AM
  END_TIME: '17:00', // 5:00 PM
  GRACE_PERIOD_MINUTES: 15, // 15 minutes grace period for late arrival
  HALF_DAY_HOURS: 4, // Minimum hours for half-day
  // Floor below which a CLOSED day earns no credit. Mirrors
  // WORK_SCHEDULE.MIN_CREDIT_HOURS in the API's attendance-compute.ts — the two
  // must agree or the badge on screen contradicts the stored status.
  MIN_CREDIT_HOURS: 1,
  FULL_DAY_HOURS: 8, // Expected hours for full day
  WORKING_DAYS: [1, 2, 3, 4, 5] as number[], // Monday to Friday (base)
  ALTERNATE_SATURDAY_WEEKS: [1, 3], // Week 1 and 3 have Saturday working
};

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
 * Get current time in HH:MM format
 */
export function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Check if a date is today
 */
export function isToday(date: string): boolean {
  const today = getCurrentDate();
  return date === today;
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
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
// Attendance Status Calculation
// ============================================================================

/**
 * Determine if check-in is late
 */
export function isLateCheckIn(checkInTime: string): boolean {
  const checkIn = new Date(checkInTime);
  const hours = checkIn.getHours();
  const minutes = checkIn.getMinutes();
  const checkInMinutes = hours * 60 + minutes;

  const startMinutes = timeToMinutes(WORK_SCHEDULE.START_TIME);
  const graceMinutes = startMinutes + WORK_SCHEDULE.GRACE_PERIOD_MINUTES;

  return checkInMinutes > graceMinutes;
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
 * Format time for display
 */
export function formatTime(dateTime: string): string {
  const d = new Date(dateTime);
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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

  // The excluded DAYS, de-duplicated — what the caller is told sits in the
  // hours but in none of the day counts.
  const uncountedDays = new Set(
    attendanceRecords
      .filter((r) => r.date && !countedRecords.includes(r))
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

  const leaveDays =
    leaveDaysInPeriod ||
    attendanceRecords.filter((r) => r.status === 'ON_LEAVE' || r.status === 'On Leave').length;

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
    const response = await resources.listAll('leave_requests', [
      query.equal('userId', userId),
      query.equal('status', 'APPROVED'),
      // Leave overlaps if: leave.startDate <= endDate AND leave.endDate >= startDate
      query.lessThanEqual('startDate', endDate),
      query.greaterThanEqual('endDate', startDate),
      ...(workspaceId ? [query.equal('workspaceId', workspaceId)] : []),
    ]
    );

    const leaveDates = new Set<string>();

    // For each approved leave, add all dates in the range
    response.items.forEach((leave: any) => {
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


