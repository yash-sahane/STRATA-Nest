/**
 * Notification Utilities
 * Helper functions for creating and managing notifications
 */

import { logger } from '@/lib/logger';

// ============================================================================
// Notification Type Configurations
// ============================================================================

export const NOTIFICATION_TYPES = {
  // Task Notifications
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_PRIORITY_CHANGED: 'TASK_PRIORITY_CHANGED',
  TASK_DUE_SOON: 'TASK_DUE_SOON',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_DEADLINE_REMINDER: 'TASK_DEADLINE_REMINDER',
  TASK_REVIEW_REQUESTED: 'TASK_REVIEW_REQUESTED',

  // Sprint Notifications
  SPRINT_READY_TO_CLOSE: 'SPRINT_READY_TO_CLOSE',

  // Requirement Notifications
  REQUIREMENT_CREATED: 'REQUIREMENT_CREATED',
  REQUIREMENT_UPDATED: 'REQUIREMENT_UPDATED',

  // Epic Notifications
  EPIC_CREATED: 'EPIC_CREATED',
  EPIC_UPDATED: 'EPIC_UPDATED',
  EPIC_COMPLETED: 'EPIC_COMPLETED',

  // Functional Requirement Notifications
  FR_CREATED: 'FR_CREATED',
  FR_ASSIGNED: 'FR_ASSIGNED',
  FR_UPDATED: 'FR_UPDATED',
  FR_STATUS_CHANGED: 'FR_STATUS_CHANGED',

  // Sprint Notifications
  SPRINT_STARTED: 'SPRINT_STARTED',
  SPRINT_ENDING_SOON: 'SPRINT_ENDING_SOON',
  SPRINT_COMPLETED: 'SPRINT_COMPLETED',
  SPRINT_TASK_ADDED: 'SPRINT_TASK_ADDED',

  // Leave Notifications
  LEAVE_REQUESTED: 'LEAVE_REQUESTED',
  LEAVE_APPROVED: 'LEAVE_APPROVED',
  LEAVE_REJECTED: 'LEAVE_REJECTED',
  LEAVE_CANCELLED: 'LEAVE_CANCELLED',

  // Attendance Notifications
  ATTENDANCE_LATE: 'ATTENDANCE_LATE',
  ATTENDANCE_MISSED: 'ATTENDANCE_MISSED',
  ATTENDANCE_REMINDER: 'ATTENDANCE_REMINDER',
  ATTENDANCE_CHECKOUT_REMINDER: 'ATTENDANCE_CHECKOUT_REMINDER',

  // Comment Notifications
  COMMENT_MENTION: 'COMMENT_MENTION',
  COMMENT_REPLY: 'COMMENT_REPLY',
  COMMENT_ON_TASK: 'COMMENT_ON_TASK',

  // Team Notifications
  TEAM_MEMBER_ADDED: 'TEAM_MEMBER_ADDED',
  TEAM_MEMBER_REMOVED: 'TEAM_MEMBER_REMOVED',
  PROJECT_INVITATION: 'PROJECT_INVITATION',
  WORKSPACE_INVITATION: 'WORKSPACE_INVITATION',
} as const;

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;

// ============================================================================
// Notification Priority
// ============================================================================

export enum NotificationPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export const NOTIFICATION_PRIORITY_CONFIG = {
  [NotificationPriority.LOW]: {
    text: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-950',
    border: 'border-gray-200 dark:border-gray-900',
  },
  [NotificationPriority.MEDIUM]: {
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-950',
    border: 'border-blue-200 dark:border-blue-900',
  },
  [NotificationPriority.HIGH]: {
    text: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-100 dark:bg-orange-950',
    border: 'border-orange-200 dark:border-orange-900',
  },
  [NotificationPriority.URGENT]: {
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-950',
    border: 'border-red-200 dark:border-red-900',
  },
};

// ============================================================================
// Notification Category
// ============================================================================

export enum NotificationCategory {
  TASK = 'TASK',
  SPRINT = 'SPRINT',
  LEAVE = 'LEAVE',
  ATTENDANCE = 'ATTENDANCE',
  COMMENT = 'COMMENT',
  TEAM = 'TEAM',
  SYSTEM = 'SYSTEM',
}

// ============================================================================
// Notification Templates
// ============================================================================

interface NotificationTemplate {
  title: (data: any) => string;
  message: (data: any) => string;
  priority: NotificationPriority;
  category: NotificationCategory;
  requiresEmail: boolean;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  // Task Notifications
  TASK_ASSIGNED: {
    title: (data) => `New Task Assigned: ${data.taskTitle}`,
    message: (data) => `${data.assignerName} assigned you a task in ${data.projectName}`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  TASK_CREATED: {
    title: (data) => `New Task Created: ${data.taskTitle}`,
    message: (data) =>
      `${data.creatorName} created a new task "${data.taskTitle}" in ${data.projectName}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  TASK_UPDATED: {
    title: (data) => `Task Updated: ${data.taskTitle}`,
    message: (data) => `${data.updaterName} updated the task "${data.taskTitle}"`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  TASK_COMPLETED: {
    title: (data) => `Task Completed: ${data.taskTitle}`,
    message: (data) => `${data.completerName} marked "${data.taskTitle}" as complete`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  TASK_STATUS_CHANGED: {
    title: (data) => `Task Status Changed: ${data.taskTitle}`,
    message: (data) => `${data.changerName} moved "${data.taskTitle}" to ${data.newStatus}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  // `generateNotification` returns null for any type with no template here, so a
  // missing entry silently notifies nobody. use-task.ts emits this one on every
  // priority change and Settings advertises the toggle — it needs a template.
  TASK_PRIORITY_CHANGED: {
    title: (data) => `Task Priority Changed: ${data.taskTitle}`,
    message: (data) =>
      `${data.changerName} changed the priority of "${data.taskTitle}" to ${data.newPriority}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  TASK_DUE_SOON: {
    title: (data) => `Task Due Soon: ${data.taskTitle}`,
    message: (data) => `"${data.taskTitle}" is due ${data.dueIn}`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  TASK_OVERDUE: {
    title: (data) => `Task Overdue: ${data.taskTitle}`,
    message: (data) => `"${data.taskTitle}" is overdue by ${data.overdueBy}`,
    priority: NotificationPriority.URGENT,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  TASK_DEADLINE_REMINDER: {
    title: (data) => `Deadline Reminder: ${data.taskTitle}`,
    message: (data) =>
      `Reminder: "${data.taskTitle}" is due on ${data.dueDate}. ${data.daysRemaining} day(s) remaining.`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  TASK_REVIEW_REQUESTED: {
    title: (data) => `Task Ready for Review: ${data.taskTitle}`,
    message: (data) =>
      `${data.submitterName} has submitted "${data.taskTitle}" (${data.taskHierarchyId}) for review in ${data.projectName}`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  TASK_REVIEWED_DONE: {
    title: (data) => `Task Approved: ${data.taskTitle}`,
    message: (data) =>
      `Your task "${data.taskTitle}" (${data.taskHierarchyId}) has been reviewed and marked as done by ${data.reviewerName}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  SPRINT_READY_TO_CLOSE: {
    title: (data) => `Sprint Ready to Close: ${data.sprintName}`,
    message: (data) =>
      `All tasks in "${data.sprintName}" are complete. The sprint is ready to be closed.`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.SPRINT,
    requiresEmail: true,
  },

  // Requirement Notifications
  REQUIREMENT_CREATED: {
    title: (data) => `New Requirement: ${data.requirementTitle}`,
    message: (data) =>
      `${data.creatorName} created a new client requirement "${data.requirementTitle}" in ${data.projectName}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  REQUIREMENT_UPDATED: {
    title: (data) => `Requirement Updated: ${data.requirementTitle}`,
    message: (data) => `${data.updaterName} updated the requirement "${data.requirementTitle}"`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  // Epic Notifications
  EPIC_CREATED: {
    title: (data) => `New Epic Created: ${data.epicTitle}`,
    message: (data) =>
      `${data.creatorName} created a new epic "${data.epicTitle}" in ${data.projectName}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  EPIC_UPDATED: {
    title: (data) => `Epic Updated: ${data.epicTitle}`,
    message: (data) => `${data.updaterName} updated the epic "${data.epicTitle}"`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  EPIC_COMPLETED: {
    title: (data) => `Epic Completed: ${data.epicTitle}`,
    message: (data) => `The epic "${data.epicTitle}" has been marked as complete`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  // Functional Requirement Notifications
  FR_CREATED: {
    title: (data) => `New FR Created: ${data.frTitle}`,
    message: (data) =>
      `${data.creatorName} created a new functional requirement "${data.frTitle}" in ${data.projectName}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  FR_ASSIGNED: {
    title: (data) => `FR Assigned: ${data.frTitle}`,
    message: (data) =>
      `${data.assignerName} assigned you to functional requirement "${data.frTitle}"`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TASK,
    requiresEmail: true,
  },

  FR_UPDATED: {
    title: (data) => `FR Updated: ${data.frTitle}`,
    message: (data) => `${data.updaterName} updated the functional requirement "${data.frTitle}"`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  FR_STATUS_CHANGED: {
    title: (data) => `FR Status Changed: ${data.frTitle}`,
    message: (data) => `"${data.frTitle}" status changed to ${data.newStatus}`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.TASK,
    requiresEmail: false,
  },

  // Sprint Notifications
  SPRINT_STARTED: {
    title: (data) => `Sprint Started: ${data.sprintName}`,
    message: (data) => `${data.sprintName} has started with ${data.taskCount} tasks`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.SPRINT,
    requiresEmail: true,
  },

  SPRINT_ENDING_SOON: {
    title: (data) => `Sprint Ending Soon: ${data.sprintName}`,
    message: (data) =>
      `${data.sprintName} ends ${data.endsIn}. ${data.remainingTasks} tasks remaining`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.SPRINT,
    requiresEmail: true,
  },

  SPRINT_COMPLETED: {
    title: (data) => `Sprint Completed: ${data.sprintName}`,
    message: (data) =>
      `${data.sprintName} completed with ${data.completedTasks}/${data.totalTasks} tasks done`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.SPRINT,
    requiresEmail: true,
  },

  SPRINT_TASK_ADDED: {
    title: (data) => `Task Added to Sprint: ${data.sprintName}`,
    message: (data) => `"${data.taskTitle}" was added to the sprint "${data.sprintName}"`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.SPRINT,
    requiresEmail: false,
  },

  // Leave Notifications
  LEAVE_REQUESTED: {
    title: (data) => `New Leave Request: ${data.employeeName}`,
    message: (data) =>
      `${data.employeeName} requested ${data.leaveType} leave for ${data.days} day(s)`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.LEAVE,
    requiresEmail: true,
  },

  LEAVE_APPROVED: {
    title: () => 'Leave Request Approved',
    message: (data) =>
      `Your ${data.leaveType} leave request for ${data.days} day(s) has been approved by ${data.approverName}`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.LEAVE,
    requiresEmail: true,
  },

  LEAVE_REJECTED: {
    title: () => 'Leave Request Rejected',
    message: (data) =>
      `Your ${data.leaveType} leave request has been rejected. Reason: ${data.reason}`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.LEAVE,
    requiresEmail: true,
  },

  LEAVE_CANCELLED: {
    title: () => 'Leave Request Cancelled',
    message: (data) => `${data.employeeName} cancelled their ${data.leaveType} leave request`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.LEAVE,
    requiresEmail: false,
  },

  // Attendance Notifications
  ATTENDANCE_LATE: {
    title: () => 'Late Check-in Alert',
    message: (data) =>
      `You checked in late today at ${data.checkInTime}. You are ${data.lateMinutes} minutes late`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.ATTENDANCE,
    requiresEmail: false,
  },

  ATTENDANCE_MISSED: {
    title: () => 'Missed Attendance',
    message: (data) => `You did not check in today (${data.date}). Please contact your manager`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.ATTENDANCE,
    requiresEmail: true,
  },

  ATTENDANCE_REMINDER: {
    title: () => 'Check-in Reminder',
    message: () => `Good morning! Don't forget to check in for today`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.ATTENDANCE,
    requiresEmail: false,
  },

  ATTENDANCE_CHECKOUT_REMINDER: {
    title: () => 'Check-out Reminder',
    message: (data) => `You've been working for ${data.hours} hours. Don't forget to check out`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.ATTENDANCE,
    requiresEmail: false,
  },

  // Comment Notifications
  COMMENT_MENTION: {
    title: (data) => `${data.mentionerName} mentioned you`,
    message: (data) => `${data.mentionerName} mentioned you in a comment on "${data.taskTitle}"`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.COMMENT,
    requiresEmail: true,
  },

  COMMENT_REPLY: {
    title: (data) => `${data.replierName} replied to your comment`,
    message: (data) => `${data.replierName} replied to your comment on "${data.taskTitle}"`,
    priority: NotificationPriority.MEDIUM,
    category: NotificationCategory.COMMENT,
    requiresEmail: false,
  },

  COMMENT_ON_TASK: {
    title: (data) => `New comment on: ${data.taskTitle}`,
    message: (data) => `${data.commenterName} commented on "${data.taskTitle}"`,
    priority: NotificationPriority.LOW,
    category: NotificationCategory.COMMENT,
    requiresEmail: false,
  },

  // Team Notifications
  TEAM_MEMBER_ADDED: {
    title: (data) => `Added to ${data.projectName}`,
    message: (data) => `${data.adderName} added you to the project "${data.projectName}"`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TEAM,
    requiresEmail: true,
  },

  TEAM_MEMBER_REMOVED: {
    title: (data) => `Removed from ${data.projectName}`,
    message: (data) => `${data.removerName} removed you from the project "${data.projectName}"`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TEAM,
    requiresEmail: true,
  },

  PROJECT_INVITATION: {
    title: (data) => `Project Invitation: ${data.projectName}`,
    message: (data) => `${data.inviterName} invited you to join "${data.projectName}"`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TEAM,
    requiresEmail: true,
  },

  WORKSPACE_INVITATION: {
    title: (data) => `Workspace Invitation: ${data.workspaceName}`,
    message: (data) => `${data.inviterName} invited you to join "${data.workspaceName}"`,
    priority: NotificationPriority.HIGH,
    category: NotificationCategory.TEAM,
    requiresEmail: true,
  },
};

// ============================================================================
// Notification Helper Functions
// ============================================================================

/**
 * Generate notification content from template
 */
export function generateNotification(
  type: string,
  data: any
): {
  title: string;
  message: string;
  priority: NotificationPriority;
  category: NotificationCategory;
  requiresEmail: boolean;
} | null {
  const template = NOTIFICATION_TEMPLATES[type];

  if (!template) {
    logger.error('No template found for notification type', { type });
    return null;
  }

  return {
    title: template.title(data),
    message: template.message(data),
    priority: template.priority,
    category: template.category,
    requiresEmail: template.requiresEmail,
  };
}

/**
 * Get notification icon based on category
 */
export function getNotificationIcon(category: NotificationCategory): string {
  const icons = {
    [NotificationCategory.TASK]: '📋',
    [NotificationCategory.SPRINT]: '🏃',
    [NotificationCategory.LEAVE]: '🏖️',
    [NotificationCategory.ATTENDANCE]: '⏰',
    [NotificationCategory.COMMENT]: '💬',
    [NotificationCategory.TEAM]: '👥',
    [NotificationCategory.SYSTEM]: '⚙️',
  };

  return icons[category] || '🔔';
}

/**
 * Get notification color based on priority
 */
export function getNotificationColor(priority: NotificationPriority): {
  text: string;
  bg: string;
  border: string;
} {
  return NOTIFICATION_PRIORITY_CONFIG[priority];
}

/**
 * Format notification time
 */
export function formatNotificationTime(date: string): string {
  const now = new Date();
  const notifDate = new Date(date);
  const diffMs = now.getTime() - notifDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return notifDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group notifications by date
 */
export function groupNotificationsByDate(notifications: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Older: [],
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  notifications.forEach((notification) => {
    const notifDate = new Date(notification.createdAt);
    const notifDay = new Date(notifDate.getFullYear(), notifDate.getMonth(), notifDate.getDate());

    if (notifDay.getTime() === today.getTime()) {
      groups.Today.push(notification);
    } else if (notifDay.getTime() === yesterday.getTime()) {
      groups.Yesterday.push(notification);
    } else if (notifDay.getTime() >= weekAgo.getTime()) {
      groups['This Week'].push(notification);
    } else {
      groups.Older.push(notification);
    }
  });

  // Remove empty groups
  Object.keys(groups).forEach((key) => {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  });

  return groups;
}

/**
 * Check if notification should trigger email
 */
export function shouldSendEmail(type: string, userPreferences?: Record<string, boolean>): boolean {
  const template = NOTIFICATION_TEMPLATES[type];

  if (!template) return false;
  if (!template.requiresEmail) return false;

  // Check user preferences if provided
  if (userPreferences && userPreferences[type] === false) {
    return false;
  }

  return true;
}

/**
 * Batch notifications by user
 */
export function batchNotificationsByUser(
  notifications: Array<{
    userId: string;
    type: string;
    data: any;
  }>
): Record<string, Array<{ type: string; data: any }>> {
  const batched: Record<string, Array<{ type: string; data: any }>> = {};

  notifications.forEach(({ userId, type, data }) => {
    if (!batched[userId]) {
      batched[userId] = [];
    }
    batched[userId].push({ type, data });
  });

  return batched;
}
