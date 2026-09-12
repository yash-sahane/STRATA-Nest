import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import { toast } from '@/hooks/use-toast';
import { createNotificationFromTemplate } from '@/hooks/use-notification';
import {
  getCurrentDate,
  getMonthDateRange,
  getUserLeaveDates,
  isWorkingDay,
  calculateAttendanceSummary,
  type AttendanceStatus,
} from '@/lib/attendance-utils';
import { countWorkingDaysBetween } from '@/lib/utils/working-days';
import { useHolidays } from '@/hooks/use-holidays';

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

export function useTodayAttendance(userId?: string, workspaceId?: string) {
  const today = getCurrentDate();
  return useQuery({
    queryKey: ['attendance', 'today', userId, workspaceId, today],
    queryFn: async () => {
      if (!userId) return null;

      const queries = [
        query.equal('userId', userId),
        query.equal('date', today)
      ];

      // Add workspaceId filter if provided
      if (workspaceId) {
        queries.push(query.equal('workspaceId', workspaceId));
      }

      const response = await resources.listAll('attendance', queries);
      if (response.items.length === 0) return null;
      return response.items[0] as unknown as Attendance;
    },
    enabled: !!userId,
    refetchInterval: 60000,
  });
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
    onSuccess: async (attendance, variables) => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });

      // Send notification if user checked in late
      const isLate = attendance.status === 'LATE';
      if (isLate) {
        await createNotificationFromTemplate({
          workspaceId: variables.workspaceId,
          userId: attendance.userId,
          type: 'ATTENDANCE_LATE',
          data: {
            checkInTime: new Date(attendance.checkInTime).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            lateMinutes: attendance.lateMinutes || 0,
            date: attendance.date,
            entityType: 'ATTENDANCE',
          },
        });
      }

      // A shut day (declared holiday, weekend) is now FILED rather than
      // refused, so the confirmation has to say so: a bare "successfully checked
      // in" hides that the row is deliberately absent from the attendance rate,
      // and the member would only discover it from a number that never moved.
      toast({
        title: 'Checked In',
        description:
          attendance.isHoliday || attendance.isWeekend
            ? 'Recorded as work on a closed day. You are not marked late, and today does not count towards your attendance rate.'
            : 'You have successfully checked in for today.',
      });
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

      toast({
        title: 'Check-in Failed',
        description,
        variant: 'destructive'
      });
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
      toast({ title: 'Checked Out', description: `You worked ${(data.workHours ?? 0).toFixed(1)} hours today.` });
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

      toast({
        title: 'Check-out Failed',
        description,
        variant: 'destructive'
      });
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
  // A public holiday is not a day anyone could have attended, so it must not sit
  // in the denominator. Without this a month with two holidays capped a perfect
  // record at ~90%.
  const { data: holidays = [], isLoading: holidaysLoading } = useHolidays(workspaceId);
  return useQuery({
    queryKey: ['attendance', 'analytics', userId, workspaceId, targetYear, targetMonth, holidays],
    queryFn: async () => {
      if (!userId) return null;
      const { start, end } = getMonthDateRange(targetYear, targetMonth);

      const queries = [
        query.equal('userId', userId),
        query.greaterThanEqual('date', start),
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

      const response = await resources.listAll('attendance', queries);
      const records = response.items as any[];

      // Only days that have already happened can be attended, so the rate's
      // denominator stops at today for the current month (using the whole
      // month renders a perfect record as ~26% on the 8th).
      const today = getCurrentDate();
      const periodEnd = end < today ? end : today;
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
