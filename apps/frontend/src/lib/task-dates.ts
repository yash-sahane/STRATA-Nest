import { differenceInCalendarDays } from 'date-fns';
import { formatDate, parseWireDate } from '@/lib/utils';

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
 */

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** The due date as the calendar day it names, or null when there is none. */
export function dueDay(dueDate: string | Date | null | undefined): Date | null {
  if (!dueDate) return null;
  // parseWireDate, not `new Date`: a date-only value read as UTC midnight is the
  // previous day for every viewer west of UTC.
  const parsed = parseWireDate(dueDate);
  return Number.isNaN(parsed.getTime()) ? null : startOfLocalDay(parsed);
}

export function isTaskOverdue(
  task: { dueDate?: string | Date | null; status?: string | null },
  now: Date = new Date()
): boolean {
  if (task.status === 'DONE') return false;
  const due = dueDay(task.dueDate);
  return due !== null && due.getTime() < startOfLocalDay(now).getTime();
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
  const due = dueDay(task.dueDate);
  if (!due || !task.dueDate) return null;
  const title = `Due ${formatDate(task.dueDate)}`;
  if (task.status === 'DONE') return { text: title, title, overdue: false };
  const ahead = differenceInCalendarDays(due, now);
  if (ahead < 0) return { text: `Overdue by ${days(-ahead)}`, title, overdue: true };
  if (ahead === 0) return { text: 'Due today', title, overdue: false };
  if (ahead === 1) return { text: 'Due tomorrow', title, overdue: false };
  if (ahead < 7) return { text: `Due in ${days(ahead)}`, title, overdue: false };
  return { text: title, title, overdue: false };
}
