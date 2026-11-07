import type { Task } from '@/types';

export interface TeamMemberWorkload {
  userId: string;
  userName: string;
  userEmail: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  workloadPercentage: number; // 0-100+
}

export interface WorkloadSummary {
  members: TeamMemberWorkload[];
  totalTasks: number;
  averageWorkload: number;
}

function isActiveTaskStatus(status: Task['status']): boolean {
  return status === 'TODO' || status === 'IN_PROGRESS' || status === 'REVIEW';
}

/**
 * How many open tasks count as a full load. The only place the 10 lives, so the
 * percentage a card draws and the band a label names are always derived from the
 * same number.
 */
export const TASKS_AT_FULL_LOAD = 10;

/**
 * THE workload scale. Both panels on /team used to carry their own, and for a
 * member with seven open tasks the card said "Moderate" while the table
 * immediately below said "Busy".
 *
 * `maxTasks` is inclusive; the last band is open-ended. Colours are the semantic
 * *-text tokens — the raw 600-weight shades these replaced measure 3.1-3.4:1 on
 * a light card, under the 4.5:1 AA floor. "Moderate" keeps a raw shade because
 * there is no token between warning and success, pinned to 700 so it passes.
 */
export const WORKLOAD_BANDS: Array<{
  maxTasks: number;
  label: string;
  color: string;
  bgColor: string;
  barColor: string;
}> = [
  {
    maxTasks: 0,
    label: 'Available',
    color: 'text-success-text',
    bgColor: 'bg-green-100 dark:bg-green-950/30',
    barColor: 'bg-green-500',
  },
  {
    maxTasks: 3,
    label: 'Light',
    color: 'text-success-text',
    bgColor: 'bg-green-100 dark:bg-green-950/30',
    barColor: 'bg-green-500',
  },
  {
    maxTasks: 6,
    label: 'Moderate',
    color: 'text-yellow-700 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-950/30',
    barColor: 'bg-yellow-500',
  },
  {
    maxTasks: TASKS_AT_FULL_LOAD,
    label: 'Busy',
    color: 'text-warning-text',
    bgColor: 'bg-orange-100 dark:bg-orange-950/30',
    barColor: 'bg-orange-500',
  },
  {
    maxTasks: Number.POSITIVE_INFINITY,
    label: 'Overloaded',
    color: 'text-destructive-text',
    bgColor: 'bg-red-100 dark:bg-red-950/30',
    barColor: 'bg-red-500',
  },
];

/** The band for a count of open tasks. */
export function workloadBandForTasks(openTasks: number) {
  const n = Number.isFinite(openTasks) ? Math.max(0, openTasks) : 0;
  return WORKLOAD_BANDS.find((b) => n <= b.maxTasks) ?? WORKLOAD_BANDS[WORKLOAD_BANDS.length - 1];
}

/**
 * The band for a workload percentage, via the count it stands for — so a card
 * showing 70% and a table showing 7 tasks name the same band.
 */
export function workloadBandForPercentage(percentage: number) {
  const pct = Number.isFinite(percentage) ? Math.max(0, percentage) : 0;
  return workloadBandForTasks(Math.round((pct / 100) * TASKS_AT_FULL_LOAD));
}

export function calculateTeamWorkload(
  tasks: Task[],
  members: Array<{ id: string; userId?: string; name: string; email: string }>
): WorkloadSummary {
  const memberWorkloads: TeamMemberWorkload[] = members.map((member) => {
    // Use userId if available (workspace_members), otherwise fall back to id
    const memberId = member.userId || member.id;

    const memberTasks = tasks.filter(
      (task) => (task.assigneeIds || []).includes(memberId) && task.status !== 'DONE'
    );

    // Calculate workload metrics
    const activeTasks = memberTasks.filter((task) => isActiveTaskStatus(task.status)).length;
    const completedTasks = tasks.filter(
      (task) => (task.assigneeIds || []).includes(memberId) && task.status === 'DONE'
    ).length;

    // Task count as a lightweight workload metric, against the same constant the
    // band table is defined in — a hardcoded 10 here and a separate set of
    // percentage thresholds below it is how the two panels came to disagree.
    const totalTasks = memberTasks.length;
    const workloadPercentage = (totalTasks / TASKS_AT_FULL_LOAD) * 100;

    return {
      userId: memberId,
      userName: member.name,
      userEmail: member.email,
      totalTasks,
      activeTasks,
      completedTasks,
      workloadPercentage: Math.round(workloadPercentage),
    };
  });

  const totalTasks = memberWorkloads.reduce((sum, member) => sum + member.totalTasks, 0);
  const averageWorkload =
    members.length > 0
      ? Math.round(
          memberWorkloads.reduce((sum, member) => sum + member.workloadPercentage, 0) /
            members.length
        )
      : 0;

  return {
    members: memberWorkloads,
    totalTasks,
    averageWorkload,
  };
}

/**
 * Text colours for the workload ramp.
 *
 * The semantic *-text tokens exist precisely for coloured text on a card: the
 * raw 600-weight palette shades this used to return measure 3.1-3.4:1 on a
 * light background, under the 4.5:1 AA floor. Only the "High" step keeps a raw
 * shade -- there is no distinct token between warning and success -- and it is
 * pinned to 700, which clears the floor.
 */
export function getWorkloadColor(percentage: number): string {
  return workloadBandForPercentage(percentage).color;
}

export function getWorkloadBgColor(percentage: number): string {
  return workloadBandForPercentage(percentage).bgColor;
}

export function getWorkloadBarColor(percentage: number): string {
  return workloadBandForPercentage(percentage).barColor;
}

export function getWorkloadStatus(percentage: number): string {
  return workloadBandForPercentage(percentage).label;
}
