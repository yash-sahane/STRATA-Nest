import { formatDate } from '@/lib/utils';
import { parseDateOnly as parseLocalDateOnly } from '@/lib/utils/working-days';

/**
 * Project start/end dates are DATE-ONLY columns and the API returns them as
 * 'YYYY-MM-DD'. `new Date('2025-08-11')` is UTC midnight, which renders as the
 * 10th anywhere west of Greenwich — so parse the parts into a local date.
 */
export function parseDateOnly(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return undefined;
  // The parsing itself lives in one place; this wrapper only adds the
  // nullable contract the project fields need.
  return parseLocalDateOnly(value);
}

/** Render a date-only project field, or `null` when it is not set. */
export function formatProjectDate(value?: string | null): string | null {
  const date = parseDateOnly(value);
  return date ? formatDate(date) : null;
}

/**
 * The project's dates as a project card shows them, each saying what it is:
 * "Started Jun 11, 2026 · Ends Sep 30, 2026". The card used to show the start
 * date alone under a calendar icon, which read as a deadline as easily as a
 * start. Tense against today; an end date is a whole day, so it "Ends" through
 * that day and "Ended" only after it.
 */
export function describeProjectDates(
  startDate?: string | null,
  endDate?: string | null,
  now: Date = new Date()
): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const parts: string[] = [];
  if (start) parts.push(`${start > today ? 'Starts' : 'Started'} ${formatDate(start)}`);
  if (end) parts.push(`${end < today ? 'Ended' : 'Ends'} ${formatDate(end)}`);
  return parts.length > 0 ? parts.join(' · ') : 'No dates set';
}
