'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useMonthlyAttendance } from '@/hooks/use-attendance';
import { useHolidays } from '@/hooks/use-holidays';
import { useTeamMembers } from '@/hooks/use-team';
import {
  getCalendarMonth,
  isWeekend,
  isWorkingDay,
  getAttendanceStatusColor,
  getAttendanceStatusIcon,
  isSaturdayWorking,
  getWeekOfMonth,
  getCurrentDate,
  getMonthDateRange,
  ATTENDANCE_STATUS,
  getUserLeaveDates,
} from '@/lib/attendance-utils';
import { businessDateOf, formatDateOnly, parseDateOnly } from '@/lib/utils/working-days';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { InlineLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';

interface AttendanceRecord {
  id: string;
  date: string;
  status: string;
  checkInTime?: string;
  checkOutTime?: string;
  workHours?: number;
}

/**
 * Every state a day cell can be painted, in the order somebody reads them.
 *
 * `UNKNOWN` is deliberately absent: it shares Weekend's grey and means "nothing to report
 * here" — a future date, or one before the person joined — which is not a state anybody
 * needs a key for.
 */
const LEGEND_STATUSES = [
  { status: 'PRESENT', label: 'Present' },
  { status: 'LATE', label: 'Late' },
  { status: 'ABSENT', label: 'Absent' },
  { status: 'HALF_DAY', label: 'Half Day' },
  { status: 'ON_LEAVE', label: 'On Leave' },
  { status: 'HOLIDAY', label: 'Holiday' },
  { status: 'WEEKEND', label: 'Weekend' },
] as const;

export function AttendanceCalendar() {
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  // A public holiday is not a working day, so a past holiday with no check-in
  // must not be painted ABSENT.
  const { data: holidays = [] } = useHolidays(currentWorkspace?.id);
  // Opens on the business day's month — the app's today — not the browser's.
  const [currentMonth, setCurrentMonth] = useState(() => parseDateOnly(getCurrentDate()).getMonth());
  const [currentYear, setCurrentYear] = useState(() => parseDateOnly(getCurrentDate()).getFullYear());
  const [leaveDates, setLeaveDates] = useState<Set<string>>(new Set());
  // The day this user's membership began. Absence before it is not absence.
  // The BUSINESS day, like every date it is compared with here: the timestamp's
  // own first ten characters are its UTC date (see businessDateOf).
  const { data: roster = [] } = useTeamMembers(currentWorkspace?.id);
  const membershipStart = React.useMemo(() => {
    const mine = roster.find((m) => m.userId === user?.id);
    return mine?.joinedAt ? businessDateOf(String(mine.joinedAt)) : '';
  }, [roster, user?.id]);

  const { data: attendanceData, isLoading, isError, refetch } = useMonthlyAttendance(
    user?.id || '',
    currentWorkspace?.id || '',
    currentYear,
    currentMonth
  );

  const calendarDates = getCalendarMonth(currentYear, currentMonth);
  const monthName = new Date(currentYear, currentMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Fetch leave dates when month/year (or workspace) changes.
  const workspaceId = currentWorkspace?.id;
  useEffect(() => {
    if (!user?.id) return;

    // Guard against out-of-order responses: paging quickly through months must
    // not leave a slower earlier request painting the wrong month's leave.
    let cancelled = false;

    const fetchLeaveDates = async () => {
      const { start: startDate, end: endDate } = getMonthDateRange(currentYear, currentMonth);

      // workspaceId keeps the read inside this workspace — leave reads are
      // scoped server-side, and leave taken in another workspace must not paint
      // this workspace's calendar.
      const dates = await getUserLeaveDates(user.id, startDate, endDate, workspaceId);
      if (!cancelled) setLeaveDates(dates);
    };

    fetchLeaveDates();

    return () => {
      cancelled = true;
    };
  }, [user?.id, workspaceId, currentYear, currentMonth]);

  const handlePreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const getAttendanceForDate = (date: Date): AttendanceRecord | undefined => {
    // Use local date string to avoid timezone issues
    const dateString = formatDateOnly(date);

    return attendanceData?.find((record) => record.date === dateString);
  };

  const getDayStatus = (date: Date): string => {
    // Use local date string to avoid timezone issues
    const dateString = formatDateOnly(date);

    const attendance = getAttendanceForDate(date);

    // If there's an attendance record, use its status
    if (attendance) {
      return attendance.status;
    }

    // Check if it's a weekend
    if (isWeekend(dateString)) {
      return 'WEEKEND';
    }

    // A configured public holiday — the office is shut, so it is neither an
    // attended day nor a missed one.
    if (holidays.includes(dateString)) {
      return 'HOLIDAY';
    }

    // Check if user is on approved leave
    if (leaveDates.has(dateString)) {
      return 'ON_LEAVE';
    }

    // A day before this membership began is not a day the user missed — there
    // was nothing to attend. Returning no status paints the neutral past-day
    // cell the code below already has, and keeps the day out of every counter in
    // monthSummary, which is what made the Calendar and Analytics tabs disagree
    // about the same month.
    if (membershipStart && dateString < membershipStart) {
      return '';
    }

    // If date is in the past and no attendance record and not on leave, mark as absent
    if (dateString < getCurrentDate() && isWorkingDay(dateString, holidays)) {
      return 'ABSENT';
    }

    return '';
  };

  const getDayCellClass = (date: Date): string => {
    // Local date string, like every other site in this file — toISOString()
    // would draw the ring and the shading on tomorrow's cell.
    const dateString = formatDateOnly(date);
    const status = getDayStatus(date);
    const isToday = dateString === getCurrentDate();
    const isPast = dateString < getCurrentDate();
    const isSaturday = date.getDay() === 6;
    const saturdayWorking = isSaturday && isSaturdayWorking(dateString);

    let classes = 'relative min-h-14 min-w-0 overflow-hidden p-1 border rounded-lg sm:min-h-[80px] sm:p-2 ';

    if (isToday) {
      classes += 'ring-2 ring-primary ring-offset-2 ';
    }

    if (status) {
      const colorClass = getAttendanceStatusColor(status);
      classes += colorClass + ' ';
    } else if (!isPast) {
      classes += 'bg-card ';
    } else {
      classes += 'bg-muted ';
    }

    // Add special styling for working Saturdays
    if (saturdayWorking && !status) {
      classes += 'ring-1 ring-blue-300 ';
    }

    return classes;
  };

  // Get the first day of the month to calculate padding
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();

  // Summary over the SAME statuses the cells are painted with — counting only
  // persisted rows would print "0 absent" next to a wall of red cells.
  const monthSummary = calendarDates.reduce(
    (acc, date) => {
      const status = getDayStatus(date);
      if (status === 'PRESENT') acc.present += 1;
      else if (status === 'LATE') acc.late += 1;
      else if (status === 'ABSENT') acc.absent += 1;
      else if (status === 'ON_LEAVE') acc.leave += 1;
      return acc;
    },
    { present: 0, late: 0, absent: 0, leave: 0 }
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attendance Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <InlineLoader />
        </CardContent>
      </Card>
    );
  }

  // An empty month and a failed month look identical once rendered, so the
  // failure has to say so rather than imply perfect absence.
  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attendance Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            title="Couldn't load this month"
            description="Your attendance for this month could not be fetched."
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Attendance Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={handlePreviousMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-0 text-center font-semibold sm:min-w-[180px]">{monthName}</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={handleNextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Working Saturday Info */}
        <div className="flex items-start gap-2 p-3 bg-info/10 border border-info/30 rounded-lg">
          <Info className="h-4 w-4 text-info-text mt-0.5 flex-shrink-0" />
          <div className="text-sm text-foreground">
            <p className="font-medium">Working Schedule</p>
            <p className="text-info-text">
              Saturdays on Week 1 and Week 3 are working days. All other Saturdays are off.
            </p>
          </div>
        </div>

        {/* Calendar Legend — built from the same colour and icon maps the CELLS use,
            rather than a second hand-written copy of them. The copy is how Holiday went
            missing: `getAttendanceStatusColor` paints a holiday purple and the legend
            listed six states, so a purple cell appeared in the grid with nothing in the
            key to say what it meant. Derived, the two cannot drift apart again. */}
        <div className="flex flex-wrap gap-2 text-xs">
          {LEGEND_STATUSES.map(({ status, label }) => (
            <Badge key={status} variant="outline" className={getAttendanceStatusColor(status)}>
              <span aria-hidden="true" className="mr-1">
                {getAttendanceStatusIcon(status)}
              </span>
              {label}
            </Badge>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center font-semibold text-xs py-2 sm:text-sm">
              {day}
            </div>
          ))}

          {/* Empty cells for padding - ensures dates align with correct weekday */}
          {Array.from({ length: firstDayOfMonth }).map((_, index) => (
            <div key={`empty-${index}`} className="min-h-14 sm:min-h-[80px]" />
          ))}

          {/* Date cells */}
          {calendarDates.map((date) => {
            // Use local date string to avoid timezone issues
            const dateString = formatDateOnly(date);

            const status = getDayStatus(date);
            const attendance = getAttendanceForDate(date);
            const isSaturday = date.getDay() === 6;
            const saturdayWorking = isSaturday && isSaturdayWorking(dateString);
            const weekNum = getWeekOfMonth(dateString);

            return (
              /* data-date: the day this cell is, for anything that has to find
                 one cell. Two browser checks found cells by a sizing class,
                 and a responsive tweak to it made one fail and the other pass
                 without looking at anything. */
              <div key={dateString} data-date={dateString} className={getDayCellClass(date)}>
                <div className="flex flex-col h-full">
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-semibold text-sm">{date.getDate()}</span>
                    {status && <span className="text-lg">{getAttendanceStatusIcon(status)}</span>}
                  </div>

                  {/* Working Saturday Badge */}
                  {saturdayWorking && (
                    <Badge
                      variant="outline"
                      /* w-fit: this is a flex item of the flex-col wrapper, so the
                         default align-items:stretch made a two-character label span
                         the entire day cell and read as a filled bar, not a badge. */
                      className="w-fit text-2xs px-1 py-0 mb-1 bg-info/10 border-blue-300 dark:border-blue-700"
                    >
                      W{weekNum}
                    </Badge>
                  )}

                  {attendance &&
                    attendance.workHours !== undefined &&
                    attendance.workHours !== null && (
                      <div className="text-xs text-muted-foreground mt-auto">
                        {attendance.workHours.toFixed(1)}h
                      </div>
                    )}

                  {status && (
                    <div className="text-2xs font-medium mt-auto">
                      {ATTENDANCE_STATUS[status as keyof typeof ATTENDANCE_STATUS] || status}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Monthly Summary */}
        {attendanceData && attendanceData.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
            <div className="text-center">
              <p className="text-2xl font-bold text-success-text">{monthSummary.present}</p>
              <p className="text-xs text-muted-foreground">Present Days</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-warning-text">{monthSummary.late}</p>
              <p className="text-xs text-muted-foreground">Late Days</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive-text">{monthSummary.absent}</p>
              <p className="text-xs text-muted-foreground">Absent Days</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-info-text">
                {attendanceData
                  .filter((r) => r.workHours)
                  .reduce((sum, r) => sum + (r.workHours || 0), 0)
                  .toFixed(1)}
                h
              </p>
              <p className="text-xs text-muted-foreground">Total Hours</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
