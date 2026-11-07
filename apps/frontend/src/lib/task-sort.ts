import { differenceInCalendarDays } from 'date-fns';
import { businessToday, dueDay } from '@/lib/task-dates';
import type { Task } from '@/types';

/** One step of a multi-field sort. */
export interface SortCriterion {
  field: string;
  direction: 'asc' | 'desc';
}

const PRIORITY_ORDER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const STATUS_ORDER: Record<string, number> = { BACKLOG: 1, TODO: 2, IN_PROGRESS: 3, REVIEW: 4, DONE: 5 };

/**
 * How pressing a task's due date is: overdue first, then today, tomorrow, the
 * next three days, the week, and further out. Whole calendar days from the due
 * DAY (dueDay): a date-only value read with `new Date` is UTC midnight — the
 * previous evening west of UTC — so a task due tomorrow sorted as due today.
 * Both days are the workspace's, as every overdue label counts them.
 */
export function urgencyScore(task: Pick<Task, 'dueDate'>, today: Date = new Date()): number {
  const due = dueDay(task.dueDate);
  if (!due) return 0;
  const daysUntilDue = differenceInCalendarDays(due, businessToday(today));
  if (daysUntilDue < 0) return 100;
  if (daysUntilDue === 0) return 90;
  if (daysUntilDue === 1) return 80;
  if (daysUntilDue <= 3) return 70;
  if (daysUntilDue <= 7) return 50;
  return Math.max(1, 30 - daysUntilDue);
}

/** Two tasks compared by one field, ascending. */
export function compareTasks(a: Task, b: Task, field: string): number {
  switch (field) {
    case 'priority':
      return (PRIORITY_ORDER[a.priority] || 0) - (PRIORITY_ORDER[b.priority] || 0);
    case 'urgency':
      return urgencyScore(a) - urgencyScore(b);
    case 'dueDate': {
      // Undated after dated. Not `?? Infinity`: two undated tasks made
      // Infinity - Infinity = NaN, which is "not equal", so the sort stopped
      // there and never reached the next criterion.
      const dayA = dueDay(a.dueDate)?.getTime();
      const dayB = dueDay(b.dueDate)?.getTime();
      if (dayA === undefined || dayB === undefined) {
        return dayA === dayB ? 0 : dayA === undefined ? 1 : -1;
      }
      return dayA - dayB;
    }
    case 'status':
      // Within one board column every card shares its status, so this orders
      // nothing there — and across columns it follows the workflow.
      return (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0);
    case 'title':
      return a.title.localeCompare(b.title);
    case 'hierarchyId':
      return a.hierarchyId.localeCompare(b.hierarchyId);
    case 'createdAt':
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    case 'updatedAt':
      return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    case 'labels':
      return (a.labels?.length || 0) - (b.labels?.length || 0);
    case 'estimatedHours':
      return (a.estimatedHours || 0) - (b.estimatedHours || 0);
    case 'position':
      // The hand-made board order — the one a drag can store. Ties go by age,
      // then id: the order the API places a dropped card among them in
      // (TasksService.placedPosition), so a drop lands where it was let go.
      return (
        a.position - b.position ||
        compareText(a.createdAt, b.createdAt) ||
        compareText(a.id, b.id)
      );
    default:
      return 0;
  }
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tasks in the order the criteria give, first criterion first. The board and
 * the tasks page both sort with this: a drop is anchored against the page's
 * order, so the two have to be the same order.
 */
export function sortTasks(tasks: readonly Task[], criteria: readonly SortCriterion[]): Task[] {
  if (criteria.length === 0) return [...tasks];
  return [...tasks].sort((a, b) => {
    for (const criterion of criteria) {
      // Undated tasks are last whichever way the dates run: "latest first" is
      // not a reason to lead with the tasks that have no date at all.
      if (criterion.field === 'dueDate') {
        const undatedA = dueDay(a.dueDate) === null;
        const undatedB = dueDay(b.dueDate) === null;
        if (undatedA !== undatedB) return undatedA ? 1 : -1;
        if (undatedA) continue;
      }
      const comparison = compareTasks(a, b, criterion.field);
      if (comparison !== 0) return criterion.direction === 'asc' ? comparison : -comparison;
    }
    return 0;
  });
}

/**
 * A position for a card dropped in front of `beforeId` in `column` (its other
 * cards, any order) — or at the bottom for ''. Only for showing the drop at
 * once: the API works out the stored position itself, from the column as it
 * stands (see `placeBefore` on PATCH /tasks/:id).
 */
export function positionBefore(column: readonly Task[], beforeId: string): number {
  const stored = sortTasks(column, [{ field: 'position', direction: 'asc' }]);
  const anchor = beforeId ? stored.findIndex((task) => task.id === beforeId) : -1;
  const at = anchor >= 0 ? anchor : stored.length;
  const above = stored[at - 1]?.position;
  const below = stored[at]?.position;
  if (above === undefined) return below === undefined ? 0 : below - 1;
  if (below === undefined) return above + 1;
  return above + (below - above) / 2;
}
