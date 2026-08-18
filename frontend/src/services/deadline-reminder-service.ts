/**
 * Deadline Reminder Service
 * Checks for upcoming task deadlines and sends notifications
 */

import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { createBulkNotifications } from '@/hooks/use-notification';
import { logger } from '@/lib/logger';
import type { Task } from '@/types';

// Store last check time to avoid duplicate notifications
const STORAGE_KEY = 'deadline_reminder_last_check';

interface DeadlineReminderConfig {
  workspaceId: string;
  daysBeforeDeadline?: number[]; // e.g., [1, 3, 7] for reminders at 1, 3, and 7 days before
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Calculate days remaining until deadline
 */
function getDaysRemaining(dueDate: string): number {
  const now = new Date();
  const due = new Date(dueDate);
  const diffTime = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Check if we should send a reminder for this day count
 */
function shouldSendReminder(daysRemaining: number, reminderDays: number[]): boolean {
  return reminderDays.includes(daysRemaining);
}

/**
 * Check for tasks with upcoming deadlines and send reminders
 */
export async function checkDeadlineReminders(
  config: DeadlineReminderConfig
): Promise<{ sent: number; tasks: string[] }> {
  const { workspaceId, daysBeforeDeadline = [1, 3, 7] } = config;

  // Check if we've already run today
  const lastCheck = localStorage.getItem(STORAGE_KEY);
  const today = new Date().toDateString();

  if (lastCheck === today) {
    return { sent: 0, tasks: [] };
  }

  try {
    // Get all tasks with due dates that are not completed
    const now = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + Math.max(...daysBeforeDeadline) + 1);

    const response = await resources.list('tasks', [
      query.equal('workspaceId', workspaceId),
      query.notEqual('status', 'DONE'),
      query.greaterThanEqual('dueDate', now.toISOString()),
      query.lessThanEqual('dueDate', maxDate.toISOString()),
      query.limit(100),
    ]);

    const tasks = response.items as unknown as Task[];
    const notificationsSent: string[] = [];

    // Process each task
    for (const task of tasks) {
      if (!task.dueDate) continue;

      const daysRemaining = getDaysRemaining(task.dueDate);

      // Skip if not a reminder day
      if (!shouldSendReminder(daysRemaining, daysBeforeDeadline)) continue;

      // Get assignees to notify
      const assignees = Array.isArray(task.assignedTo)
        ? task.assignedTo
        : typeof task.assignedTo === 'string'
          ? [task.assignedTo]
          : [];

      const validAssignees = assignees.filter(
        (id: string) => id && typeof id === 'string' && id.trim() !== ''
      );

      if (validAssignees.length === 0) continue;

      // Get project name
      let projectName = 'Project';
      try {
        const project = await resources.get('projects', task.projectId
        );
        projectName = project.name || 'Project';
      } catch (error) {
        logger.error('Failed to get project name', { taskId: task.id, error });
      }

      // Send deadline reminder notification
      try {
        await createBulkNotifications({
          workspaceId,
          userIds: validAssignees,
          type: 'TASK_DEADLINE_REMINDER',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            taskHierarchyId: task.hierarchyId,
            projectId: task.projectId,
            projectName,
            dueDate: formatDate(new Date(task.dueDate)),
            daysRemaining,
            entityType: 'TASK',
          },
        });

        notificationsSent.push(task.title);
      } catch (error) {
        logger.error('Failed to send deadline reminder', { taskId: task.id, error });
      }
    }

    // Also check for overdue tasks
    const overdueResponse = await resources.list('tasks', [
      query.equal('workspaceId', workspaceId),
      query.notEqual('status', 'DONE'),
      query.lessThan('dueDate', now.toISOString()),
      query.limit(50),
    ]);

    const overdueTasks = overdueResponse.items as unknown as Task[];

    for (const task of overdueTasks) {
      if (!task.dueDate) continue;

      const daysOverdue = Math.abs(getDaysRemaining(task.dueDate));

      // Only send overdue reminders for tasks 1-7 days overdue (not spam old ones)
      if (daysOverdue > 7) continue;

      const assignees = Array.isArray(task.assignedTo)
        ? task.assignedTo
        : typeof task.assignedTo === 'string'
          ? [task.assignedTo]
          : [];

      const validAssignees = assignees.filter(
        (id: string) => id && typeof id === 'string' && id.trim() !== ''
      );

      if (validAssignees.length === 0) continue;

      // Get project name
      let projectName = 'Project';
      try {
        const project = await resources.get('projects', task.projectId
        );
        projectName = project.name || 'Project';
      } catch (error) {
        logger.error('Failed to get project name', { taskId: task.id, error });
      }

      try {
        await createBulkNotifications({
          workspaceId,
          userIds: validAssignees,
          type: 'TASK_OVERDUE',
          data: {
            taskId: task.id,
            taskTitle: task.title,
            taskHierarchyId: task.hierarchyId,
            projectId: task.projectId,
            projectName,
            overdueBy: `${daysOverdue} day(s)`,
            entityType: 'TASK',
          },
        });

        notificationsSent.push(`${task.title} (overdue)`);
      } catch (error) {
        logger.error('Failed to send overdue notification', { taskId: task.id, error });
      }
    }

    // Update last check time
    localStorage.setItem(STORAGE_KEY, today);

    return { sent: notificationsSent.length, tasks: notificationsSent };
  } catch (error) {
    logger.error('Failed to check deadline reminders', { workspaceId, error });
    return { sent: 0, tasks: [] };
  }
}

/**
 * Hook to use deadline reminder service
 * Call this in dashboard/layout to check for deadlines on load
 */
export function useDeadlineReminderCheck(workspaceId?: string) {
  if (typeof window === 'undefined' || !workspaceId) {
    return { checkReminders: async () => ({ sent: 0, tasks: [] }) };
  }

  const checkReminders = async () => {
    return checkDeadlineReminders({
      workspaceId,
      daysBeforeDeadline: [1, 3, 7], // Send reminders at 1, 3, and 7 days before deadline
    });
  };

  return { checkReminders };
}
