import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { query, resources } from '@/lib/api/client';
import { toHolidaySet, type HolidayDates } from '@/lib/utils/working-days';
import { toast } from 'sonner';

/**
 * A workspace's public holidays, as the 'YYYY-MM-DD' Set the working-day
 * helpers accept.
 *
 * `isWorkingDay`, `countWorkingDaysBetween` and `countWorkingDaysInMonth` have
 * all accepted an optional holiday set for a while, and their doc comments say
 * "Pass `holidays` to exclude public holidays from the count as well" — but
 * every call site passed one argument, and nothing in the app ever fetched
 * `/holidays`. The plumbing existed with nothing flowing through it, so a month
 * containing a company holiday counted that holiday as an expected working day
 * and reported a perfect attendance record as short.
 *
 * Optional holidays are excluded: the office is open on those, so they ARE
 * working days. This mirrors `LeaveRequestsService.holidaysIn` on the server.
 */
export function useHolidays(workspaceId?: string) {
  return useQuery({
    queryKey: ['holidays', workspaceId],
    enabled: Boolean(workspaceId),
    // Holidays change a handful of times a year; there is no reason to re-ask
    // on every screen that needs a working-day count.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      if (!workspaceId) return [];
      const response = await resources.listAll<{ date: string; isOptional?: boolean }>('holidays', [
        query.equal('workspaceId', workspaceId),
      ]);
      return response.items
        .filter((h) => !h.isOptional)
        .map((h) => String(h.date).slice(0, 10));
    },
  });
}

/** `useHolidays` pre-normalized to the Set the working-day helpers want, so a
 *  caller can pass it straight into a per-day loop without re-normalizing. */
export function useHolidaySet(workspaceId?: string): {
  holidays: HolidayDates;
  isLoading: boolean;
} {
  const { data, isLoading } = useHolidays(workspaceId);
  // One Set per answer, not one per render: callers put it in dependency
  // arrays, and a fresh Set every time re-ran every effect that read it.
  const holidays = useMemo(() => toHolidaySet(data), [data]);
  return { holidays, isLoading };
}

// ============================================================================
// The calendar itself: listing every entry, and (for approvers) changing it
// ============================================================================

/** One entry of a workspace's holiday calendar, as the API serves it. */
export interface Holiday {
  id: string;
  workspaceId: string;
  name: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  /** The office stays OPEN on an optional holiday; a member may take it as leave. */
  isOptional: boolean;
  description: string;
}

/**
 * Every holiday in the workspace calendar, optional ones included, in date order.
 *
 * `useHolidays` above answers a narrower question (which DAYS are closed), and
 * was the only thing that ever read this collection: the API has had full CRUD
 * for holidays all along and no screen called any of it, so the calendar every
 * leave count and attendance rate depends on could only be edited in the
 * database.
 */
export function useHolidayList(workspaceId?: string) {
  return useQuery({
    queryKey: ['holiday-list', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<Holiday[]> => {
      if (!workspaceId) return [];
      const response = await resources.listAll<Holiday>('holidays', [
        query.equal('workspaceId', workspaceId),
      ]);
      return [...response.items]
        .map((h) => ({ ...h, date: String(h.date).slice(0, 10) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
  });
}

/** Both views of the calendar, and everything derived from which days are closed. */
function invalidateHolidays(queryClient: QueryClient, workspaceId: string): void {
  queryClient.invalidateQueries({ queryKey: ['holiday-list', workspaceId] });
  queryClient.invalidateQueries({ queryKey: ['holidays', workspaceId] });
  // The named calendar the Attendance page reads ("Closed: <holiday>"): cached
  // for an hour and left out, so a holiday just added did not show there.
  queryClient.invalidateQueries({ queryKey: ['holidayCalendar', workspaceId] });
}

/** What the API reports a calendar change did to leave and attendance on record. */
interface HolidayReconciliation {
  attendanceRows: number;
  leaveRequests: number;
  /** Days given back to people's balances. */
  daysReturned: number;
}

/**
 * The API brings leave and attendance already on record into line with the
 * calendar as part of the same save (holiday-reconcile.ts). Say what that did:
 * a balance that moved without anybody being told is a balance nobody trusts.
 */
function describeReconciliation(reconciled?: HolidayReconciliation): string {
  if (!reconciled || (reconciled.leaveRequests === 0 && reconciled.attendanceRows === 0)) {
    return '';
  }
  const parts: string[] = [];
  if (reconciled.leaveRequests > 0) {
    parts.push(
      `${reconciled.leaveRequests} leave ${reconciled.leaveRequests === 1 ? 'request was' : 'requests were'} re-counted`
    );
  }
  if (reconciled.daysReturned > 0) {
    parts.push(
      `${reconciled.daysReturned} ${reconciled.daysReturned === 1 ? 'day was' : 'days were'} returned to balances`
    );
  }
  return parts.length > 0 ? `${parts.join(' and ')}.` : '';
}

/** Everything a calendar change can move besides the calendar itself. */
function invalidateWhatHolidaysTouch(queryClient: QueryClient) {
  for (const key of [
    'leaveRequests',
    'teamLeaveRequests',
    'leaveBalance',
    'leaveCommitments',
    'teamLeaveBalances',
    'attendance',
    'teamAttendance',
    'teamAttendanceRange',
  ]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      name: string;
      date: string;
      isOptional: boolean;
    }) =>
      (await resources.create('holidays', data)) as unknown as Holiday & {
        reconciled?: HolidayReconciliation;
      },
    onSuccess: (holiday, variables) => {
      invalidateHolidays(queryClient, variables.workspaceId);
      invalidateWhatHolidaysTouch(queryClient);
      toast.success('Holiday added', { description: `${variables.name} is on the calendar. ${describeReconciliation(holiday.reconciled)}`.trim() });
    },
    onError: (error: unknown) => {
      toast.error("Couldn't add the holiday", { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ holidayId }: { holidayId: string; workspaceId: string }) => {
      await resources.remove('holidays', holidayId);
    },
    onSuccess: (_result, variables) => {
      invalidateHolidays(queryClient, variables.workspaceId);
      invalidateWhatHolidaysTouch(queryClient);
      toast.success('Holiday removed', { description: 'It is a working day again. Leave that covers it has been re-counted and charged for it.' });
    },
    onError: (error: unknown) => {
      toast.error("Couldn't remove the holiday", { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}
