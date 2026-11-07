import { differenceInCalendarDays } from 'date-fns';
import { formatDate } from '@/lib/utils';
import { businessDateOf, parseDateOnly } from '@/lib/utils/working-days';

/**
 * When a task is overdue — one answer, for every screen that says so.
 *
 * There were five. The dashboard counted whole calendar days and called a task
 * due today "Due today". Analytics, the calendar, project health and the team
 * workload each compared the due date to the current INSTANT instead: a due
 * date is a day, stored as that day's midnight, so from one minute past
 * midnight the same task was "overdue" on four screens and "due today" on the
 * fifth — and the totals they showed for the same project never agreed.
 *
 * A task is overdue when it is not finished and its due DAY is before today.
 * Due today is not overdue: there is the whole of today left to do it in.
 *
 * Both days are the WORKSPACE's (`businessDateOf`, the zone it files its days
 * in), not the viewer's. The Team page's counts come from the API, which reads
 * them that way; these read the viewer's own clock, so somebody a few hours
 * east or west of the office saw a task "overdue" here and not there, or "due
 * today" on one screen and "due tomorrow" on the next.
 */

/** The due date as the workspace day it names, 'YYYY-MM-DD', or null when there is none. */
export function dueDayKey(dueDate: string | Date | null | undefined): string | null {
  if (!dueDate) return null;
  return businessDateOf(dueDate) || null;
}

/**
 * The due date as the calendar day it names, or null when there is none — the
 * workspace's day, at local midnight, so date arithmetic on it counts whole days.
 */
export function dueDay(dueDate: string | Date | null | undefined): Date | null {
  const key = dueDayKey(dueDate);
  return key ? parseDateOnly(key) : null;
}

/** Today, the workspace's day, at local midnight — what `dueDay` is measured against. */
export function businessToday(now: Date = new Date()): Date {
  return parseDateOnly(businessDateOf(now));
}

export function isTaskOverdue(
  task: { dueDate?: string | Date | null; status?: string | null },
  now: Date = new Date()
): boolean {
  if (task.status === 'DONE') return false;
  const due = dueDayKey(task.dueDate);
  // 'YYYY-MM-DD' strings compare in date order.
  return due !== null && due < businessDateOf(now);
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/**
 * What a card says about its due date, by the day — the rule above.
 *
 * The sprint board said "Due 28 days ago" in the same grey as everything else,
 * and "Due 10 hours ago" all through the day a task was due: it measured from
 * the due date's midnight to this instant. A finished task gets its date, not a
 * warning. `text` is short for a card; `title` is the date in full.
 */
export function dueDateLabel(
  task: { dueDate?: string | Date | null; status?: string | null },
  now: Date = new Date()
): { text: string; title: string; overdue: boolean } | null {
  const key = dueDayKey(task.dueDate);
  if (!key) return null;
  // The day it is due in the workspace, as every other label here counts it.
  const title = `Due ${formatDate(key)}`;
  if (task.status === 'DONE') return { text: title, title, overdue: false };
  const ahead = differenceInCalendarDays(parseDateOnly(key), businessToday(now));
  if (ahead < 0) return { text: `Overdue by ${days(-ahead)}`, title, overdue: true };
  if (ahead === 0) return { text: 'Due today', title, overdue: false };
  if (ahead === 1) return { text: 'Due tomorrow', title, overdue: false };
  if (ahead < 7) return { text: `Due in ${days(ahead)}`, title, overdue: false };
  return { text: title, title, overdue: false };
}
