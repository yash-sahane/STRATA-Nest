import { useQuery } from '@tanstack/react-query';
import { query, resources } from '@/lib/api/client';
import { toHolidaySet, type HolidayDates } from '@/lib/utils/working-days';

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
  return { holidays: toHolidaySet(data), isLoading };
}
