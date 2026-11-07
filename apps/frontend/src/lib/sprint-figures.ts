import { differenceInCalendarDays } from 'date-fns';
import type { Sprint, Task } from '@/types';
import { parseWireDate } from '@/lib/utils';

export interface SprintFigures {
  total: number;
  completed: number;
  /** Whole percent of the tasks done. */
  completionRate: number;
  /**
   * `live`: counted from the tasks in it now. `snapshot`: recorded when it
   * closed. `unrecorded`: closed before figures were kept — there is no true
   * answer, and none is invented.
   */
  source: 'live' | 'snapshot' | 'unrecorded';
}

/**
 * How far a sprint got, in tasks — the one answer the board, Analytics and the
 * sprint list all give.
 *
 * Tasks only: a requirement is delivered by its tasks, and counting its card
 * as well counted the same work twice. And a closed sprint is read from the
 * figures recorded as it closed: completion rolls its unfinished tasks out, so
 * what is still attached is the finished work alone, and every closed sprint
 * would otherwise read 100%.
 */
export function sprintFigures(
  sprint: Pick<Sprint, 'status' | 'totalTaskCount' | 'completedTaskCount'> | null | undefined,
  sprintTasks: ReadonlyArray<Pick<Task, 'status'>>
): SprintFigures {
  const rate = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);
  if (sprint?.status === 'COMPLETED') {
    if (typeof sprint.totalTaskCount === 'number' && typeof sprint.completedTaskCount === 'number') {
      return {
        total: sprint.totalTaskCount,
        completed: sprint.completedTaskCount,
        completionRate: rate(sprint.completedTaskCount, sprint.totalTaskCount),
        source: 'snapshot',
      };
    }
    const done = sprintTasks.filter((task) => task.status === 'DONE').length;
    return { total: sprintTasks.length, completed: done, completionRate: rate(done, sprintTasks.length), source: 'unrecorded' };
  }
  const done = sprintTasks.filter((task) => task.status === 'DONE').length;
  return { total: sprintTasks.length, completed: done, completionRate: rate(done, sprintTasks.length), source: 'live' };
}

export interface SprintSchedule {
  /** Calendar days the sprint spans, its first and last day both included. */
  totalDays: number;
  /** Days left with today counted: the last day reads 1, a sprint whose end has passed 0. */
  daysRemaining: number;
  /** Days begun, today included: 0 before the first day, `totalDays` from the last. */
  daysElapsed: number;
  /** Days until the first day; 0 once it has begun. */
  startsInDays: number;
  /** Days since the last day; 0 until it has passed. */
  endedDaysAgo: number;
}

/**
 * Where a sprint is in its dates, in CALENDAR days with today counted.
 *
 * Analytics used `differenceInDays(end, now)`: whole 24-hour spans from this
 * instant to the end's midnight. That truncates, so the first day of a ten-day
 * sprint read 8 days left and the last day read 0 — over, with a day of it still
 * to work. And an active sprint whose end had passed read "0 days" under a full
 * bar, which looks like a sprint finishing on time, not one three weeks overdue.
 *
 * Sprint dates are date-only wire values, read as the local days they name —
 * never as UTC midnight, which is the previous day west of UTC.
 */
export function sprintSchedule(
  sprint: Pick<Sprint, 'startDate' | 'endDate'>,
  now: Date = new Date()
): SprintSchedule {
  const start = parseWireDate(sprint.startDate);
  const end = parseWireDate(sprint.endDate);
  const totalDays = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const toEnd = differenceInCalendarDays(end, now); // 0 on the last day
  const sinceStart = differenceInCalendarDays(now, start); // 0 on the first day
  return {
    totalDays,
    daysRemaining: Math.min(totalDays, Math.max(0, toEnd + 1)),
    daysElapsed: Math.min(totalDays, Math.max(0, sinceStart + 1)),
    startsInDays: Math.max(0, -sinceStart),
    endedDaysAgo: Math.max(0, -toEnd),
  };
}
