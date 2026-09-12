/**
 * useDeadlineReminders Hook
 *
 * Asks the SERVER to run the workspace's deadline/overdue scan once after the
 * dashboard loads. The scan itself lives in
 * apps/api/src/modules/notifications/deadline-reminder.service.ts and is
 * idempotent per (recipient, task, type, UTC day), so this trigger is safe to
 * fire from every member's browser — the guards below only keep it cheap.
 */

'use client';

import { useEffect, useRef } from 'react';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { checkDeadlineReminders } from '@/services/deadline-reminder-service';
import { logger } from '@/lib/logger';

interface UseDeadlineRemindersOptions {
  enabled?: boolean;
}

export function useDeadlineReminders(options: UseDeadlineRemindersOptions = {}) {
  const { enabled = true } = options;
  const { currentWorkspace } = useCurrentWorkspace();
  /** Workspaces this tab has already asked about — a ref, not state, so it never
   *  re-renders, and keyed by id so switching workspaces still triggers once. */
  const requested = useRef<Set<string>>(new Set());

  const workspaceId = currentWorkspace?.id;

  useEffect(() => {
    if (!enabled || !workspaceId || requested.current.has(workspaceId)) {
      return;
    }

    // Small delay to let the page load first
    const timeoutId = setTimeout(async () => {
      // Latch BEFORE awaiting: setting it afterwards leaves a multi-second
      // window in which a second effect run passes the guard and fires again.
      requested.current.add(workspaceId);
      const result = await checkDeadlineReminders({ workspaceId });
      if (result.sent > 0) {
        logger.info('Deadline reminders sent', { count: result.sent });
      }
    }, 2000); // Wait 2 seconds after page load

    return () => clearTimeout(timeoutId);
    // Only primitives here: an options object or an array literal in this list
    // would be rebuilt every render and re-fire the effect on every render.
  }, [workspaceId, enabled]);

  // Return method to manually trigger the scan (Settings / dev tooling).
  const checkNow = async () => {
    if (!workspaceId) return { sent: 0, tasks: [] };
    return checkDeadlineReminders({ workspaceId });
  };

  return { checkNow };
}
