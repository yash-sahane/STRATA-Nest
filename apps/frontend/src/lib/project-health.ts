import type { Project, Task } from '@/types';

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

export function calculateProjectHealth(
  project: Project,
  tasks: Task[]
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

  // Check overdue tasks
  const now = new Date();
  const overdueTasks = projectTasks.filter(t => {
    if (!t.dueDate || t.status === 'DONE') return false;
    return new Date(t.dueDate) < now;
  });
  const overdueCount = overdueTasks.length;
  const overdueRate = (overdueCount / totalTasks) * 100;

  // Check blocked tasks
  const blockedTasks = projectTasks.filter(t => {
    if (t.status === 'DONE' || !t.blockedBy || t.blockedBy.length === 0) return false;
    // Check if any blocking tasks are not done
    return tasks.some(blockingTask => 
      t.blockedBy.includes(blockingTask.id) && blockingTask.status !== 'DONE'
    );
  });
  const blockedCount = blockedTasks.length;

  // Active tasks (not done, not blocked)
  const activeTasks = projectTasks.filter(
    t => t.status !== 'DONE' && !blockedTasks.some(bt => bt.id === t.id)
  );
  const activeCount = activeTasks.length;

  // Calculate score (0-100)
  let score = 100;

  // Factor 1: Completion rate (40% weight)
  score -= (100 - completionRate) * 0.4;

  // Factor 2: Overdue rate (30% weight) - penalize heavily
  score -= overdueRate * 0.6;

  // Factor 3: Blocked tasks (20% weight)
  const blockedRate = (blockedCount / totalTasks) * 100;
  score -= blockedRate * 0.4;

  // Factor 4: Critical priority overdue tasks (10% weight)
  const criticalOverdue = overdueTasks.filter(t => t.priority === 'CRITICAL');
  const criticalOverdueRate = (criticalOverdue.length / totalTasks) * 100;
  score -= criticalOverdueRate * 1.0;

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

  if (completionRate < 30 && totalTasks > 5) {
    recommendations.push('Low completion rate. Consider breaking down large tasks or reviewing priorities.');
  }

  if (criticalOverdue.length > 0) {
    recommendations.push(`${criticalOverdue.length} critical task${criticalOverdue.length > 1 ? 's are' : ' is'} overdue! Immediate action required.`);
  }

  if (activeCount > 20) {
    recommendations.push('High number of active tasks. Consider focusing on fewer tasks at once.');
  }

  if (recommendations.length === 0) {
    if (score >= 90) {
      recommendations.push('Excellent project health! Keep up the great work.');
    } else if (score >= 70) {
      recommendations.push('Good project health. Monitor overdue tasks and blockers.');
    }
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
