/**
 * Deadline Reminder Service
 *
 * Thin trigger for the SERVER-SIDE scan
 * (apps/api/src/modules/notifications/deadline-reminder.service.ts).
 *
 * This module used to do the whole job in the browser: list every open task in
 * the workspace, fan out `POST /notifications` per assignee, and dedupe on
 * `localStorage`. That is wrong per-member, not just per-render — localStorage
 * is per browser, so N members opening the dashboard produced N duplicate
 * reminders (and N emails) for every assignee, and each member needed to be
 * able to read the whole workspace's tasks to compute them.
 *
 * The scan now runs once, server-side, deduped in the database against the
 * reminders already written today, so triggering it more than once is a no-op.
 * The client's only remaining job is to ask.
 *
 * REMAINING TRADEOFF: the trigger is still client-initiated, so a workspace
 * whose members never open the dashboard gets no reminders that day. Moving the
 * trigger to a scheduled BullMQ job needs a processor in apps/worker (the only
 * place queue consumers live in this repo) — see the notes returned with this
 * change.
 */

import { restClient } from '@/lib/api/rest-client';
import { logger } from '@/lib/logger';

const DEADLINE_SCAN_PATH = '/api/v1/notifications/deadline_scan/';

interface DeadlineReminderConfig {
  workspaceId: string;
}

/**
 * Ask the server to run the workspace's daily deadline + overdue scan.
 * Never throws: a reminder scan must not be able to break the dashboard.
 */
export async function checkDeadlineReminders(
  config: DeadlineReminderConfig
): Promise<{ sent: number; tasks: string[] }> {
  const { workspaceId } = config;
  if (!workspaceId) return { sent: 0, tasks: [] };

  try {
    const response = await restClient.post(DEADLINE_SCAN_PATH, { workspaceId });
    // `tasks` is kept in the shape for the callers that log it; the server
    // deliberately does not return task titles to a caller who may not be
    // allowed to read them.
    return { sent: Number(response?.created ?? 0), tasks: [] };
  } catch (error) {
    logger.error('Failed to check deadline reminders', { workspaceId, error });
    return { sent: 0, tasks: [] };
  }
}
