/**
 * DeadlineReminderChecker
 * A client component that checks for upcoming deadlines when the dashboard loads
 * This is a silent background component with no UI
 */

'use client';

import { useDeadlineReminders } from '@/hooks/use-deadline-reminders';

export function DeadlineReminderChecker() {
  // This hook automatically checks for deadlines on mount
  useDeadlineReminders({ enabled: true });

  // No UI - this is a silent background checker
  return null;
}
