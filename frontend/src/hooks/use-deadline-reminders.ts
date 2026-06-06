/**
 * useDeadlineReminders Hook
 * Automatically checks for upcoming deadlines when user loads the dashboard
 */

'use client';

import { useEffect, useRef } from 'react';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { checkDeadlineReminders } from '@/services/deadline-reminder-service';
import { logger } from '@/lib/logger';

interface UseDeadlineRemindersOptions {
  enabled?: boolean;
  daysBeforeDeadline?: number[];
}

export function useDeadlineReminders(options: UseDeadlineRemindersOptions = {}) {
  const { enabled = true, daysBeforeDeadline = [1, 3, 7] } = options;
  const { currentWorkspace } = useCurrentWorkspace();
  const hasChecked = useRef(false);

  useEffect(() => {
    // Only run once per session and if enabled
    if (!enabled || !currentWorkspace?.id || hasChecked.current) {
      return;
    }

    // Small delay to let the page load first
    const timeoutId = setTimeout(async () => {
      try {
        const result = await checkDeadlineReminders({
          workspaceId: currentWorkspace.id,
          daysBeforeDeadline,
        });

        if (result.sent > 0) {
          logger.info('Deadline reminders sent', { count: result.sent, tasks: result.tasks });
        }

        hasChecked.current = true;
      } catch (error) {
        logger.error('Failed to check deadline reminders', { error });
      }
    }, 2000); // Wait 2 seconds after page load

    return () => clearTimeout(timeoutId);
  }, [currentWorkspace?.id, enabled, daysBeforeDeadline]);

  // Return method to manually trigger check
  const checkNow = async () => {
    if (!currentWorkspace?.id) return { sent: 0, tasks: [] };

    // Clear the storage to force a new check
    if (typeof window !== 'undefined') {
      localStorage.removeItem('deadline_reminder_last_check');
    }

    return checkDeadlineReminders({
      workspaceId: currentWorkspace.id,
      daysBeforeDeadline,
    });
  };

  return { checkNow };
}
