import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import {
  getCurrentDate,
  getMonthDateRange,
  getUserLeaveDates,
  isWorkingDay,
  attendanceWindowStart,
  calculateAttendanceSummary,
  type AttendanceStatus,
} from '@/lib/attendance-utils';
import {
  countWorkingDaysBetween,
  formatDateOnly,
  parseDateOnly,
} from '@/lib/utils/working-days';
import { useHolidays } from '@/hooks/use-holidays';
import { useTeamMembers } from './use-team';
import { toast } from 'sonner';

export interface Attendance {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  workspaceId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  workHours?: number;
  status: AttendanceStatus;
  lateMinutes?: number;
  location?: string;
  notes?: string;
  /** Server-stamped from the workspace calendar and the day marker — a day the
   *  office was shut. Both are kept out of the attendance rate's numerator and
   *  denominator, and neither is ever graded late. */
  isHoliday?: boolean;
  isWeekend?: boolean;
}

/** One entry of the workspace's closed-office calendar. */
export interface ClosedHoliday {
  /** 'YYYY-MM-DD'. */
  date: string;
  name: string;
}

/**
 * The workspace's public holidays WITH their names.
 *
 * `useHolidays` answers "is this date a holiday?" and throws the rest of the
 * row away, which is all a working-day count needs. The Today tab needs more
 * than that: it has to be able to say WHICH holiday the office is closed for
 * ("Public Holiday — the office is closed today" tells a member nothing they
 * can check against the company calendar).
 *
 * Optional holidays are excluded on the same rule everything else uses — the
 * office is open on a restricted holiday, so it is an ordinary working day.
 *
 * This is a second `/holidays` read alongside `useHolidays` (both cached for an
 * hour, so it is one extra request per session, not per render). The tidier
 * shape is for `use-holidays.ts` to hold the rows and for `useHolidays` to map
 * THIS down to its date list; that belongs in that file.
 */
export function useHolidayCalendar(workspaceId?: string) {
  return useQuery({
    queryKey: ['holidayCalendar', workspaceId],
    enabled: Boolean(workspaceId),
    // Same hour-long staleness as useHolidays: the calendar changes a handful
    // of times a year.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<ClosedHoliday[]> => {
      if (!workspaceId) return [];
      const response = await resources.listAll<{
        date: string;
        name?: string;
        isOptional?: boolean;
      }>('holidays', [query.equal('workspaceId', workspaceId)]);
      return response.items
        .filter((h) => !h.isOptional)
        .map((h) => ({ date: String(h.date).slice(0, 10), name: h.name?.trim() || 'Public Holiday' }));
    },
  });
}

/** Where the caller stands right now, as `GET /attendance/current` answers it. */
interface AttendanceStanding {
  /** The row Check Out would close: today's, or yesterday's shift still running. */
  record: Attendance | null;
  /** True when `record` is a shift that began on the previous day. */
  continuing: boolean;
  /** The most recent earlier day that was checked into and never closed. */
  unclosed: Attendance | null;
}

/**
 * The caller's own attendance, as the API sees it.
 *
 * This used to ask for "the row dated today" — the browser's today. After
 * midnight that found nothing and offered Check In to somebody in the middle
 * of a shift; and a day whose check-out was forgotten vanished from this
 * screen the next morning, still open, with nobody told. The API answers the
 * real question: which row Check Out would close, and whether an earlier day
 * was left open.
 */
function useAttendanceNow<T>(
  userId: string | undefined,
  workspaceId: string | undefined,
  select: (standing: AttendanceStanding) => T
) {
  return useQuery({
    queryKey: ['attendance', 'now', userId, workspaceId],
    queryFn: async (): Promise<AttendanceStanding> =>
      (await restClient.get('/api/v1/attendance/current/', {
        params: { workspaceId },
      })) as AttendanceStanding,
    enabled: !!userId && !!workspaceId,
    refetchInterval: 60000,
    select,
  });
}

/** The row the widget's Check Out would close, or null. */
export function useTodayAttendance(userId?: string, workspaceId?: string) {
  return useAttendanceNow(userId, workspaceId, (standing) => standing.record);
}

/** What the widget has to SAY about that row, and about a day left open. */
export function useAttendanceStanding(userId?: string, workspaceId?: string) {
  return useAttendanceNow(userId, workspaceId, (standing) => ({
    continuing: standing.continuing,
    unclosed: standing.unclosed,
  }));
}

export function useCheckIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      location?: string;
      notes?: string
    }) => {
      if (!data.workspaceId) {
        throw new Error('Workspace id is required. Please select a workspace first.');
      }

      // Server-computed check-in: the timestamp, lateMinutes and status come
      // from the server clock, so the browser's clock cannot forge an on-time
      // arrival or an 8-hour day.
      const attendance = await restClient.post('/api/v1/attendance/check-in/', {
        workspaceId: data.workspaceId,
        location: data.location || '',
        notes: data.notes || '',
      });
      return attendance as Attendance;
    },
    onSuccess: async (attendance) => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });

      // No "you checked in late" notification to the person who has just
      // checked in: the confirmation below says it, and a notice about your
      // own act a second earlier was noise in the bell.

      // A shut day (declared holiday, weekend) is now FILED rather than
      // refused, so the confirmation has to say so: a bare "successfully checked
      // in" hides that the row is deliberately absent from the attendance rate,
      // and the member would only discover it from a number that never moved.
      toast.success('Checked In', { description: attendance.isHoliday || attendance.isWeekend
            ? 'Recorded as work on a closed day. You are not marked late, and today does not count towards your attendance rate.'
            : 'You have successfully checked in for today.' });
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Failed to check in';
      const reason = errorMessage.toLowerCase();
      let description = errorMessage;

      // Provide specific guidance based on error. There is one attendance
      // record per day, so a second check-in is never possible — don't tell the
      // user to "check out first".
      if (reason.includes('already completed attendance')) {
        description = 'You have already checked in and out today. Attendance for today is closed.';
      } else if (reason.includes('already checked in')) {
        description = 'You have already checked in today. Use Check Out when you finish for the day.';
      } else if (reason.includes('workspace id')) {
        description = 'Please select a workspace before checking in.';
      } else if (reason.includes('network') || reason.includes('fetch')) {
        description = 'Network error. Please check your internet connection and try again.';
      }

      toast.error('Check-in Failed', { description: description });
    },
  });
}

export function useCheckOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { workspaceId: string; notes?: string }) => {
      // Server-computed check-out: workHours and the resulting status are
      // derived from the stored check-in and the server clock.
      const updated = await restClient.post('/api/v1/attendance/check-out/', {
        workspaceId: data.workspaceId,
        ...(data.notes ? { notes: data.notes } : {}),
      });
      return updated as Attendance;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Checked Out', { description: `You worked ${(data.workHours ?? 0).toFixed(1)} hours today.` });
    },
    onError: (error: Error) => {
      const errorMessage = error.message || 'Failed to check out';
      const reason = errorMessage.toLowerCase();
      let description = errorMessage;

      // Provide specific guidance based on error
      if (reason.includes('already checked out')) {
        description = 'You have already checked out for today.';
      } else if (reason.includes('not checked in')) {
        description = 'You must check in before you can check out.';
      } else if (reason.includes('network') || reason.includes('fetch')) {
        description = 'Network error. Please check your internet connection and try again.';
      }

      toast.error('Check-out Failed', { description: description });
    },
  });
}

export function useMonthlyAttendance(userId?: string, workspaceId?: string, year?: number, month?: number) {
  const currentDate = new Date();
  const targetYear = year ?? currentDate.getFullYear();
  const targetMonth = month ?? currentDate.getMonth();
  const { start, end } = getMonthDateRange(targetYear, targetMonth);
  return useQuery({
    queryKey: ['attendance', 'monthly', userId, workspaceId, targetYear, targetMonth],
    queryFn: async () => {
      if (!userId) return [];

      const queries = [
        query.equal('userId', userId),
        query.greaterThanEqual('date', start),
        query.lessThanEqual('date', end),
        query.orderDesc('date'),
      ];

      // Add workspaceId filter if provided
      if (workspaceId) {
        queries.push(query.equal('workspaceId', workspaceId));
      }

      const response = await resources.listAll('attendance', queries);
      return response.items as unknown as Attendance[];
    },
    enabled: !!userId,
    refetchInterval: 60000, // Refetch every minute for real-time updates
  });
}

export function useAttendanceAnalytics(userId?: string, workspaceId?: string, year?: number, month?: number) {
  const currentDate = new Date();
  const targetYear = year ?? currentDate.getFullYear();
  const targetMonth = month ?? currentDate.getMonth();
  // A day before this person joined is not a day they failed to attend. Without
  // it the denominator ran from the 1st for somebody who joined on the 5th, and
  // the Calendar tab — which does apply the boundary — reported 0 absences while
  // this reported 9 for the same user and the same month.
  const { data: roster = [] } = useTeamMembers(workspaceId);
  const joinedAt = roster.find((m) => m.userId === userId)?.joinedAt;
  // A public holiday is not a day anyone could have attended, so it must not sit
  // in the denominator. Without this a month with two holidays capped a perfect
  // record at ~90%.
  const { data: holidays = [], isLoading: holidaysLoading } = useHolidays(workspaceId);
  return useQuery({
    queryKey: [
      'attendance',
      'analytics',
      userId,
      workspaceId,
      targetYear,
      targetMonth,
      holidays,
      joinedAt,
    ],
    queryFn: async () => {
      if (!userId) return null;
      const { start: monthStart, end } = getMonthDateRange(targetYear, targetMonth);
      // Everything below measures from here, not from the first of the month.
      const start = attendanceWindowStart(monthStart, joinedAt);

      const queries = [
        query.equal('userId', userId),
        query.greaterThanEqual('date', monthStart),
        query.lessThanEqual('date', end),
        // Not conditional, unlike the other attendance queries: the rate is a
        // ratio of two workspace-scoped quantities. Unscoped, the rows span
        // every workspace the member belongs to while the holiday list (which
        // needs a workspace) comes back empty — two rows for one date over a
        // denominator that still counts the holidays. The query is disabled
        // without a workspace instead (see `enabled` below), so this predicate
        // is always present.
        query.equal('workspaceId', workspaceId!),
      ];

      const response = await resources.listAll<Attendance>('attendance', queries);
      const records = response.items;

      // Only days that have already happened can be attended, so the rate's
      // denominator stops at today for the current month (using the whole
      // month renders a perfect record as ~26% on the 8th).
      //
      // And it stops BEFORE today, not at it. Today is in progress: a member who
      // has not checked in yet at 11am has not missed the day, and counting it
      // showed them "1 absence" and "0% — 0 of 1 day" the morning they joined,
      // while the Calendar tab beside it said 0. The calendar was right; its
      // `getDayStatus` marks a day ABSENT only when it is strictly before today.
      //
      // This adopts that same rule so the two agree by construction: a day counts
      // if it has a record, or if it is a completed working day. Today therefore
      // re-enters the window as soon as there IS a row for it, which is what makes
      // checking in this morning count as present rather than vanish until
      // tomorrow. One `periodEnd` still drives the denominator, the leave
      // subtraction and the numerator predicate, so they cannot drift apart.
      const today = getCurrentDate();
      const lastCompletedDay = (() => {
        const d = parseDateOnly(today);
        d.setDate(d.getDate() - 1);
        return formatDateOnly(d);
      })();
      const hasRecordToday = records.some(
        (r: { date?: string }) => r.date && String(r.date).slice(0, 10) === today,
      );
      const periodEnd = end < today ? end : hasRecordToday ? today : lastCompletedDay;
      const elapsedWorkingDays =
        periodEnd < start ? 0 : countWorkingDaysBetween(start, periodEnd, holidays);

      // Approved leave is not persisted as an attendance row, so it is fetched
      // separately and excluded from the denominator instead of counting as an
      // absence. Scoped to the same workspace as the attendance rows above —
      // leave taken in another workspace must not shrink this one's denominator.
      const leaveDates = await getUserLeaveDates(
        userId,
        start,
        periodEnd < start ? start : periodEnd,
        workspaceId
      );
      const leaveDays = Array.from(leaveDates).filter(
        // Same holiday set as the denominator: a leave day that falls on a
        // holiday was never in `elapsedWorkingDays`, so subtracting it again
        // would shrink the denominator twice and overstate the rate.
        (d) => d >= start && d <= periodEnd && isWorkingDay(d, holidays)
      ).length;

      // The numerator has to be built from the same days as the denominator.
      // `elapsedWorkingDays` already drops weekends, holidays and anything
      // after today, and `leaveDays` is subtracted from it — but every
      // attendance row in the month was still counted as a day attended, so a
      // member who checked in on two holidays read "Attendance Rate 167% — 5 of
      // 3 days so far this month" with the bar stuck at full.
      const summary = calculateAttendanceSummary(
        records,
        elapsedWorkingDays,
        leaveDays,
        (day) =>
          day >= start &&
          day <= periodEnd &&
          isWorkingDay(day, holidays) &&
          !leaveDates.has(day)
      );
      return { ...summary, records, period: { year: targetYear, month: targetMonth, start, end } };
    },
    enabled: !!userId && !!workspaceId && !holidaysLoading,
    refetchInterval: 60000, // Refetch every minute for real-time updates
  });
}
