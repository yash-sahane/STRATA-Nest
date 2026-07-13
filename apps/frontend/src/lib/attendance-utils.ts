import { z } from 'zod';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { logger } from '@/lib/logger';

/**
 * Attendance Management Utilities
 * Handles check-in/check-out, work hours calculation, and attendance analytics
 */

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
  FULL_DAY_HOURS: 8, // Expected hours for full day
  WORKING_DAYS: [1, 2, 3, 4, 5] as number[], // Monday to Friday (base)
  ALTERNATE_SATURDAY_WEEKS: [1, 3], // Week 1 and 3 have Saturday working
};

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const checkInSchema = z.object({
  userId: z.string().min(1, 'User id is required'),
  date: z.string().min(1, 'Date is required'),
  checkInTime: z.string().min(1, 'Check-in time is required'),
  location: z.string().optional(),
  notes: z.string().optional(),
});

export const checkOutSchema = z.object({
  attendanceId: z.string().min(1, 'Attendance id is required'),
  checkOutTime: z.string().min(1, 'Check-out time is required'),
  notes: z.string().optional(),
});

// ============================================================================
// Date and Time Utilities
// ============================================================================

/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get current time in HH:MM format
 */
export function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Get current date-time in ISO format
 */
export function getCurrentDateTime(): string {
  return new Date().toISOString();
}

/**
 * Check if a date is today
 */
export function isToday(date: string): boolean {
  const today = getCurrentDate();
  return date === today;
}

/**
 * Get week number of month (1-5) for a given date
 */
export function getWeekOfMonth(date: string): number {
  const d = new Date(date);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const dayOfMonth = d.getDate();
  const firstDayOfWeek = firstDay.getDay();

  // Calculate which week of the month this date falls in
  return Math.ceil((dayOfMonth + firstDayOfWeek) / 7);
}

/**
 * Check if Saturday is a working day for the given date
 * Week 1 and Week 3 have Saturday working
 */
export function isSaturdayWorking(date: string): boolean {
  const weekOfMonth = getWeekOfMonth(date);
  return WORK_SCHEDULE.ALTERNATE_SATURDAY_WEEKS.includes(weekOfMonth);
}

/**
 * Check if a date is a weekend (non-working Saturday or Sunday)
 */
export function isWeekend(date: string): boolean {
  const day = new Date(date).getDay();

  // Sunday is always a weekend
  if (day === 0) return true;

  // Saturday depends on week of month
  if (day === 6) {
    return !isSaturdayWorking(date);
  }

  return false;
}

/**
 * Check if a date is a working day
 * Monday-Friday always working, Saturday working on weeks 1 and 3
 */
export function isWorkingDay(date: string): boolean {
  const day = new Date(date).getDay();

  // Sunday is never a working day
  if (day === 0) return false;

  // Saturday is working only on weeks 1 and 3
  if (day === 6) {
    return isSaturdayWorking(date);
  }

  // Monday to Friday are always working days
  return WORK_SCHEDULE.WORKING_DAYS.includes(day);
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes to time string (HH:MM)
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate time difference in minutes
 */
export function calculateTimeDifference(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

/**
 * Format minutes to hours and minutes display
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Calculate work hours between check-in and check-out
 */
export function calculateWorkHours(checkInTime: string, checkOutTime: string): number {
  const checkIn = new Date(checkInTime);
  const checkOut = new Date(checkOutTime);
  const diffMs = checkOut.getTime() - checkIn.getTime();
  return diffMs / (1000 * 60 * 60); // Convert to hours
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

/**
 * Calculate late arrival minutes
 */
export function calculateLateMinutes(checkInTime: string): number {
  const checkIn = new Date(checkInTime);
  const hours = checkIn.getHours();
  const minutes = checkIn.getMinutes();
  const checkInMinutes = hours * 60 + minutes;

  const startMinutes = timeToMinutes(WORK_SCHEDULE.START_TIME);

  if (checkInMinutes <= startMinutes) {
    return 0;
  }

  return checkInMinutes - startMinutes;
}

/**
 * Determine attendance status based on work hours
 */
export function determineAttendanceStatus(
  checkInTime?: string,
  checkOutTime?: string,
  workHours?: number
): AttendanceStatus {
  if (!checkInTime) {
    return 'ABSENT';
  }

  if (isLateCheckIn(checkInTime)) {
    if (!checkOutTime || !workHours) {
      return 'LATE';
    }

    if (workHours < WORK_SCHEDULE.HALF_DAY_HOURS) {
      return 'HALF_DAY';
    }

    return 'LATE';
  }

  if (checkOutTime && workHours) {
    if (workHours < WORK_SCHEDULE.HALF_DAY_HOURS) {
      return 'HALF_DAY';
    }
  }

  return 'PRESENT';
}

/**
 * Get attendance status for a date with leave information
 */
export function getAttendanceStatusWithLeave(
  date: string,
  hasCheckIn: boolean,
  isOnLeave: boolean
): AttendanceStatus {
  if (isWeekend(date)) {
    return 'WEEKEND';
  }

  if (isOnLeave) {
    return 'ON_LEAVE';
  }

  if (!hasCheckIn && !isToday(date)) {
    return 'ABSENT';
  }

  return 'PRESENT';
}

// ============================================================================
// Attendance Analytics
// ============================================================================

/**
 * Calculate attendance rate percentage
 */
export function calculateAttendanceRate(
  presentDays: number,
  totalWorkingDays: number
): number {
  if (totalWorkingDays === 0) return 0;
  return Math.round((presentDays / totalWorkingDays) * 100);
}

/**
 * Calculate average work hours
 */
export function calculateAverageWorkHours(workHours: number[]): number {
  if (workHours.length === 0) return 0;
  const total = workHours.reduce((sum, hours) => sum + hours, 0);
  return Math.round((total / workHours.length) * 10) / 10; // Round to 1 decimal
}

/**
 * Count working days in a month (including alternate Saturdays)
 */
export function countWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateString = date.toISOString().split('T')[0];

    if (isWorkingDay(dateString)) {
      workingDays++;
    }
  }

  return workingDays;
}

/**
 * Get month date range
 */
export function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

/**
 * Calculate total work hours in period
 */
export function calculateTotalWorkHours(attendanceRecords: { workHours?: number }[]): number {
  return attendanceRecords.reduce((total, record) => {
    return total + (record.workHours || 0);
  }, 0);
}

/**
 * Count late arrivals
 */
export function countLateArrivals(attendanceRecords: { status: string }[]): number {
  return attendanceRecords.filter(
    (record) => record.status === 'LATE' || record.status === 'Late'
  ).length;
}

/**
 * Count absences
 */
export function countAbsences(attendanceRecords: { status: string }[]): number {
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
  const statusMap: Record<string, string> = {
    PRESENT: 'bg-green-100 text-green-800 border-green-200',
    Present: 'bg-green-100 text-green-800 border-green-200',
    ABSENT: 'bg-red-100 text-red-800 border-red-200',
    Absent: 'bg-red-100 text-red-800 border-red-200',
    LATE: 'bg-orange-100 text-orange-800 border-orange-200',
    Late: 'bg-orange-100 text-orange-800 border-orange-200',
    HALF_DAY: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'Half Day': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    ON_LEAVE: 'bg-blue-100 text-blue-800 border-blue-200',
    'On Leave': 'bg-blue-100 text-blue-800 border-blue-200',
    WEEKEND: 'bg-gray-100 text-gray-800 border-gray-200',
    Weekend: 'bg-gray-100 text-gray-800 border-gray-200',
    HOLIDAY: 'bg-purple-100 text-purple-800 border-purple-200',
    Holiday: 'bg-purple-100 text-purple-800 border-purple-200',
  };

  return statusMap[status] || 'bg-gray-100 text-gray-800 border-gray-200';
}

/**
 * Get status icon emoji
 */
export function getAttendanceStatusIcon(status: AttendanceStatus | string): string {
  const iconMap: Record<string, string> = {
    PRESENT: '?',
    Present: '?',
    ABSENT: '?',
    Absent: '?',
    LATE: '?',
    Late: '?',
    HALF_DAY: '½',
    'Half Day': '½',
    ON_LEAVE: '???',
    'On Leave': '???',
    WEEKEND: '??',
    Weekend: '??',
    HOLIDAY: '??',
    Holiday: '??',
  };

  return iconMap[status] || '•';
}

/**
 * Format date for display
 */
export function formatDate(date: string, format: 'short' | 'long' = 'short'): string {
  const d = new Date(date);

  if (format === 'short') {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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
 * Get working schedule description for a date
 */
export function getWorkingDayDescription(date: string): string {
  const day = new Date(date).getDay();
  const weekOfMonth = getWeekOfMonth(date);

  if (day === 0) return 'Sunday - Weekend';
  if (day === 6) {
    if (isSaturdayWorking(date)) {
      return `Saturday Week ${weekOfMonth} - Working Day`;
    }
    return `Saturday Week ${weekOfMonth} - Weekend`;
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${dayNames[day]} - Working Day`;
}

/**
 * Get all working Saturdays in a month
 */
export function getWorkingSaturdaysInMonth(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const workingSaturdays: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    if (date.getDay() === 6) {
      const dateString = date.toISOString().split('T')[0];
      if (isSaturdayWorking(dateString)) {
        workingSaturdays.push(dateString);
      }
    }
  }

  return workingSaturdays;
}

/**
 * Check if user can check in
 */
export function canCheckIn(lastCheckIn?: { date: string; checkOutTime?: string }): boolean {
  if (!lastCheckIn) return true;

  // Can check in if last check-in was not today
  if (!isToday(lastCheckIn.date)) return true;

  // Can check in if checked out from last session
  return !!lastCheckIn.checkOutTime;
}

/**
 * Check if user can check out
 */
export function canCheckOut(lastCheckIn?: { date: string; checkOutTime?: string }): boolean {
  if (!lastCheckIn) return false;

  // Must have checked in today
  if (!isToday(lastCheckIn.date)) return false;

  // Must not have checked out yet
  return !lastCheckIn.checkOutTime;
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
  presentDays: number;
  absentDays: number;
  lateDays: number;
  halfDays: number;
  leaveDays: number;
  attendanceRate: number;
  totalWorkHours: number;
  averageWorkHours: number;
}

export function calculateAttendanceSummary(
  attendanceRecords: Array<{
    status: string;
    workHours?: number;
  }>,
  workingDaysInPeriod: number
): AttendanceSummary {
  const presentDays = attendanceRecords.filter(
    (r) => r.status === 'PRESENT' || r.status === 'Present'
  ).length;

  const absentDays = countAbsences(attendanceRecords);
  const lateDays = countLateArrivals(attendanceRecords);

  const halfDays = attendanceRecords.filter(
    (r) => r.status === 'HALF_DAY' || r.status === 'Half Day'
  ).length;

  const leaveDays = attendanceRecords.filter(
    (r) => r.status === 'ON_LEAVE' || r.status === 'On Leave'
  ).length;

  const totalWorkHours = calculateTotalWorkHours(attendanceRecords);
  const workHoursArray = attendanceRecords
    .filter((r) => r.workHours && r.workHours > 0)
    .map((r) => r.workHours!);
  const averageWorkHours = calculateAverageWorkHours(workHoursArray);

  return {
    totalDays: attendanceRecords.length,
    workingDays: workingDaysInPeriod,
    presentDays,
    absentDays,
    lateDays,
    halfDays,
    leaveDays,
    attendanceRate: calculateAttendanceRate(presentDays + lateDays, workingDaysInPeriod),
    totalWorkHours: Math.round(totalWorkHours * 10) / 10,
    averageWorkHours,
  };
}

// ============================================================================
// Leave Integration
// ============================================================================

/**
 * Check if user is on approved leave for a specific date
 * @param userId - User id to check
 * @param date - Date to check (YYYY-MM-DD format)
 * @returns Promise<boolean> - True if user is on approved leave
 */
export async function isUserOnLeave(userId: string, date: string): Promise<boolean> {
  if (!userId || !date) return false;

  try {
    // query for approved leave requests that cover this date
    const response = await resources.list('leave_requests', [
      query.equal('userId', userId),
      query.equal('status', 'APPROVED'),
      query.lessThanEqual('startDate', date),
      query.greaterThanEqual('endDate', date),
    ]
    );

    return response.items.length > 0;
  } catch (error) {
    logger.error('Error checking leave status', { error });
    return false;
  }
}

/**
 * Get all approved leave dates for a user in a date range
 * @param userId - User id
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Promise<Set<string>> - Set of dates user is on leave
 */
export async function getUserLeaveDates(
  userId: string,
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  if (!userId || !startDate || !endDate) return new Set();

  try {
    // query for all approved leaves that overlap with the date range
    const response = await resources.list('leave_requests', [
      query.equal('userId', userId),
      query.equal('status', 'APPROVED'),
      // Leave overlaps if: leave.startDate <= endDate AND leave.endDate >= startDate
      query.lessThanEqual('startDate', endDate),
      query.greaterThanEqual('endDate', startDate),
    ]
    );

    const leaveDates = new Set<string>();

    // For each approved leave, add all dates in the range
    response.items.forEach((leave: any) => {
      const leaveStart = new Date(leave.startDate);
      const leaveEnd = new Date(leave.endDate);
      const rangeStart = new Date(startDate);
      const rangeEnd = new Date(endDate);

      // Get the actual start and end dates within our query range
      const actualStart = leaveStart > rangeStart ? leaveStart : rangeStart;
      const actualEnd = leaveEnd < rangeEnd ? leaveEnd : rangeEnd;

      // Add each date in the leave period
      const currentDate = new Date(actualStart);
      while (currentDate <= actualEnd) {
        leaveDates.add(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    });

    return leaveDates;
  } catch (error) {
    logger.error('Error fetching leave dates', { error });
    return new Set();
  }
}

// ============================================================================
// Holiday Utilities
// ============================================================================

/**
 * Check if a date is a holiday
 */
export function isHoliday(date: string, holidays: Array<{ date: string }>): boolean {
  return holidays.some(holiday => holiday.date === date);
}

/**
 * Get holiday for a specific date
 */
export function getHolidayForDate(
  date: string,
  holidays: Array<{ date: string; name: string; type: string }>
): { date: string; name: string; type: string } | undefined {
  return holidays.find(holiday => holiday.date === date);
}

/**
 * Check if a date is a working day (excluding weekends AND holidays)
 */
export function isWorkingDayWithHolidays(
  date: string,
  holidays?: Array<{ date: string }>
): boolean {
  // Check if weekend
  if (isWeekend(date)) return false;

  // Check if holiday
  if (holidays && isHoliday(date, holidays)) return false;

  // Otherwise it's a working day
  return isWorkingDay(date);
}

