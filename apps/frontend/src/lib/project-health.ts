import type { Project, Task } from '@/types';
import { isTaskOverdue } from '@/lib/task-dates';
import { parseWireDate } from '@/lib/utils';

export interface ProjectHealthMetrics {
  score: number; // 0-100
  completionRate: number; // 0-100
  overdueRate: number; // 0-100
  activeTasksCount: number;
  completedTasksCount: number;
  overdueTasksCount: number;
  blockedTasksCount: number;
  status: 'critical' | 'warning' | 'good' | 'excellent';
  recommendations: string[];
}

/**
 * Completion may trail the elapsed share of the timeline by this many points
 * before it counts as slipping: work finishes in lumps, not a smooth line.
 */
const SCHEDULE_ALLOWANCE = 10;
/** More tasks than this in progress or in review at once is spread thin. */
const IN_FLIGHT_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The share (0-1) of the project's start→end timeline that has passed, or null
 * when there is no timeline to judge against. The end date is a whole day, so
 * the timeline runs to the end of it. Only for a project being delivered: one
 * on hold has paused its clock, and a finished one has nothing left to slip.
 */
function elapsedShare(project: Project, now: Date): number | null {
  if (project.status !== 'PLANNING' && project.status !== 'ACTIVE') return null;
  if (!project.startDate || !project.endDate) return null;
  // parseWireDate: the dates are date-only, and `new Date('YYYY-MM-DD')` is UTC
  // midnight — the day before for everybody west of UTC.
  const start = parseWireDate(project.startDate).getTime();
  const end = parseWireDate(project.endDate).getTime() + DAY_MS;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * How healthy a project is: how much is going WRONG with it, not how much of it
 * is done.
 *
 * The score used to open by taking (100 − completion) × 0.4 off, so a project
 * nobody had started yet — nothing overdue, nothing blocked, months before its
 * end date — scored 60, "Warning", for being new; and on a project card the
 * figure read as its completion. Unfinished work is only a problem when it is
 * LATE: overdue, blocked, or behind the project's own schedule. Those, and only
 * those, cost points.
 *
 * Points off a starting 100, each factor capped (only overdue work, the most
 * concrete trouble, can make a project critical on its own):
 *   overdue tasks       up to 65 — 10 for having any, plus 1 per percentage point
 *                                  of the project's tasks that are overdue
 *   critical overdue    up to 20 — 10 per overdue CRITICAL task
 *   behind schedule     up to 40 — 1 per point completion trails the elapsed share
 *                                  of the start→end timeline, past SCHEDULE_ALLOWANCE
 *   blocked             up to 15 — 0.3 per point of the OPEN tasks that are blocked
 * The bands are unchanged: under 40 critical, under 70 warning, under 90 good.
 */
export function calculateProjectHealth(
  project: Project,
  tasks: Task[],
  now: Date = new Date()
): ProjectHealthMetrics {
  const projectTasks = tasks.filter(t => t.projectId === project.id);
  const totalTasks = projectTasks.length;

  if (totalTasks === 0) {
    return {
      score: 100,
      completionRate: 0,
      overdueRate: 0,
      activeTasksCount: 0,
      completedTasksCount: 0,
      overdueTasksCount: 0,
      blockedTasksCount: 0,
      status: 'excellent',
      recommendations: ['No tasks yet. Create tasks to track project health.'],
    };
  }

  // Calculate metrics
  const completedTasks = projectTasks.filter(t => t.status === 'DONE');
  const completedCount = completedTasks.length;
  const completionRate = (completedCount / totalTasks) * 100;

  // Check overdue tasks — see lib/task-dates.ts: due today is not overdue.
  const overdueTasks = projectTasks.filter((t) => isTaskOverdue(t, now));
  const overdueCount = overdueTasks.length;
  const overdueRate = (overdueCount / totalTasks) * 100;

  // Blocked: not done, and waiting on a task that is not done either. The
  // blocker may sit in another project, so it is looked up in every task given.
  const unfinishedIds = new Set(tasks.filter((t) => t.status !== 'DONE').map((t) => t.id));
  const blockedTasks = projectTasks.filter(
    (t) => t.status !== 'DONE' && (t.blockedBy ?? []).some((id) => unfinishedIds.has(id))
  );
  const blockedCount = blockedTasks.length;

  // Active tasks (not done, not blocked)
  const blockedIds = new Set(blockedTasks.map((t) => t.id));
  const activeCount = projectTasks.filter(
    (t) => t.status !== 'DONE' && !blockedIds.has(t.id)
  ).length;
  const openCount = totalTasks - completedCount;

  // Points off a perfect 100 — see the weights above the function.
  let score = 100;

  if (overdueCount > 0) score -= Math.min(65, 10 + overdueRate);

  const criticalOverdue = overdueTasks.filter(t => t.priority === 'CRITICAL');
  score -= Math.min(20, criticalOverdue.length * 10);

  // Behind schedule: less done than the calendar says should be by now.
  const elapsed = elapsedShare(project, now);
  const slip = elapsed === null ? 0 : elapsed * 100 - completionRate;
  if (slip > SCHEDULE_ALLOWANCE) score -= Math.min(40, slip - SCHEDULE_ALLOWANCE);

  // Of the OPEN tasks, not of all of them: finished work cannot be blocked, and
  // counting it diluted a jam at the end of a project to almost nothing.
  if (openCount > 0) score -= Math.min(15, (blockedCount / openCount) * 100 * 0.3);

  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, score));

  // Determine status
  let status: 'critical' | 'warning' | 'good' | 'excellent';
  if (score < 40) status = 'critical';
  else if (score < 70) status = 'warning';
  else if (score < 90) status = 'good';
  else status = 'excellent';

  // Generate recommendations
  const recommendations: string[] = [];

  if (overdueCount > 0) {
    recommendations.push(`${overdueCount} task${overdueCount > 1 ? 's are' : ' is'} overdue. Update deadlines or complete them soon.`);
  }

  if (blockedCount > 0) {
    recommendations.push(`${blockedCount} task${blockedCount > 1 ? 's are' : ' is'} blocked by dependencies. Resolve blockers to improve flow.`);
  }

  // Not "low completion rate": a project that has barely begun has done little,
  // and that is only a concern once the calendar says it should have done more.
  if (elapsed !== null && slip > SCHEDULE_ALLOWANCE) {
    recommendations.push(
      `Behind schedule: ${Math.round(elapsed * 100)}% of the timeline has passed, but ${Math.round(completionRate)}% of tasks are done. Re-plan the remaining work or move the end date.`
    );
  }

  if (criticalOverdue.length > 0) {
    recommendations.push(`${criticalOverdue.length} critical task${criticalOverdue.length > 1 ? 's are' : ' is'} overdue! Immediate action required.`);
  }

  // Work actually in flight. Counting every open task here told a freshly
  // planned project with a full backlog to "focus on fewer tasks at once".
  const inFlight = projectTasks.filter(
    (t) => t.status === 'IN_PROGRESS' || t.status === 'REVIEW'
  ).length;
  if (inFlight > IN_FLIGHT_LIMIT) {
    recommendations.push(`${inFlight} tasks are in progress or in review at once. Finishing some before starting more keeps work flowing.`);
  }

  // Every point lost above comes with its reason, so an empty list means
  // nothing is late, blocked or behind.
  if (recommendations.length === 0) {
    recommendations.push(
      elapsed !== null
        ? 'On track: nothing is overdue or blocked, and work is keeping pace with the schedule.'
        : !project.startDate || !project.endDate
          ? 'On track: nothing is overdue or blocked. Give the project start and end dates to check its progress against a schedule too.'
          : 'Nothing is overdue or blocked.'
    );
  }

  return {
    score: Math.round(score),
    completionRate: Math.round(completionRate),
    overdueRate: Math.round(overdueRate),
    activeTasksCount: activeCount,
    completedTasksCount: completedCount,
    overdueTasksCount: overdueCount,
    blockedTasksCount: blockedCount,
    status,
    recommendations,
  };
}

/**
 * Ink for the score, on the plain card.
 *
 * The -600 shades were measured as rendered and did not hold up in light theme: yellow-600
 * came to 2.94:1 on the white card, which fails even the 3:1 large-text floor the
 * `text-4xl font-bold` score faces, and green-600 (3.22:1) and emerald-600 (3.65:1) sat
 * just above it. The whole-app sweep caught the yellow one on a real project page.
 *
 * -700 in light clears 4.5:1 on all four -- red 6.42:1, yellow 4.93:1, green 4.95:1,
 * emerald 5.36:1 -- so this holds at normal size too, not just at the floor it happens to
 * face at the one call site today. Dark keeps -400, measured 6.85:1 to 12.58:1 on the dark
 * card. Hues are unchanged, so the four bands stay as tellable apart as they were.
 */
export function getHealthColor(score: number): string {
  if (score < 40) return 'text-red-700 dark:text-red-400';
  if (score < 70) return 'text-yellow-700 dark:text-yellow-400';
  if (score < 90) return 'text-green-700 dark:text-green-400';
  return 'text-emerald-700 dark:text-emerald-400';
}

export function getHealthBgColor(score: number): string {
  if (score < 40) return 'bg-red-100 dark:bg-red-950/30';
  if (score < 70) return 'bg-yellow-100 dark:bg-yellow-950/30';
  if (score < 90) return 'bg-green-100 dark:bg-green-950/30';
  return 'bg-emerald-100 dark:bg-emerald-950/30';
}

export function getHealthBorderColor(score: number): string {
  if (score < 40) return 'border-red-300 dark:border-red-700';
  if (score < 70) return 'border-yellow-300 dark:border-yellow-700';
  if (score < 90) return 'border-green-300 dark:border-green-700';
  return 'border-emerald-300 dark:border-emerald-700';
}
