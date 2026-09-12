import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToCollection, getRealtimeEventType } from '@/lib/api/realtime';
import { COLLECTIONS } from '@/lib/api/config';
import type { ApiModels } from '@/lib/api/client';
import { logger } from '@/lib/logger';

/**
 * Hook to subscribe to real-time updates for a collection
 * Automatically invalidates React query cache on changes
 *
 * MOUNT STATUS (checked repo-wide): useTasksRealtime and useSprintsRealtime are
 * mounted by the task board and the sprint board; useProjectsRealtime,
 * useLeaveRequestsRealtime and useAttendanceRealtime by their own pages.
 * Notifications are NOT here — NotificationCenter owns that subscription,
 * because it also raises the toast for an inbound notification.
 */
export function useCollectionSubscription(
  collectionId: string,
  queryKeys: string[],
  enabled: boolean = true
) {
  // NOTE ON GRANULARITY: `queryKeys` are query-key ROOTS, invalidated as
  // `[root]` — a prefix match that covers every key beginning with it. They must
  // therefore be spelled exactly as the owning useQuery spells element 0.
  // Parameterised variants such as `tasks-${projectId}` match NOTHING: TanStack
  // compares keys element-by-element, and the id lives at index 1 of
  // ['tasks', projectId] — it is never fused into the root string.
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Every caller passes a freshly-allocated array literal, so `queryKeys` must
  // never be a raw dependency: the effect would tear the subscription down and
  // rebuild it on EVERY render, closing and reconnecting the WebSocket (with
  // backoff) each time. Depend on the contents, read the latest via a ref.
  const queryKeysRef = useRef(queryKeys);
  // Sync after render, never during it: writing a ref in the render phase is
  // unsafe under concurrent rendering (and flagged by react-hooks/refs). The
  // ref is seeded with the first-render value, and the subscription callback
  // only ever reads it after commit, so this is always up to date in practice.
  useEffect(() => {
    queryKeysRef.current = queryKeys;
  });
  const queryKeysId = queryKeys.join('|');

  /**
   * Events arriving inside this window share one refetch.
   *
   * Measured before this: five remote writes in quick succession produced five
   * ws frames and five full list refetches — 1.00 GETs per event, which is
   * minimal per event and wasteful per ACTION, because bursts are the normal
   * case. A teammate reordering a board emits one event per card moved.
   *
   * 120ms is chosen to absorb a drag or a bulk update while staying well under
   * the threshold at which a single change stops feeling immediate. Invalidation
   * is idempotent, so coalescing changes what is fetched not at all — only how
   * many times.
   */
  const COALESCE_MS = 120;
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    logger.debug(`Subscribing to collection: ${collectionId}`);

    subscriptionRef.current = subscribeToCollection(
      collectionId,
      (response: ApiModels.RealtimeEvent<Record<string, unknown>>) => {
        const eventType = getRealtimeEventType(response.event);
        logger.debug('Realtime event received', {
          collection: collectionId,
          type: eventType,
          documentId: response.payload.id,
        });

        // Invalidate all related queries — once per burst, not once per event.
        // The keys are read at FLUSH time from the ref, so a burst spanning a
        // re-render still invalidates the current set.
        if (flushTimer.current !== null) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => {
          flushTimer.current = null;
          queryKeysRef.current.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }, COALESCE_MS);
      }
    );

    return () => {
      logger.debug(`Unsubscribing from collection: ${collectionId}`);
      subscriptionRef.current?.unsubscribe();
      // A pending flush after unmount would invalidate on behalf of a component
      // that is gone, refetching for nobody.
      if (flushTimer.current !== null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [collectionId, enabled, queryClient, queryKeysId]);
}

/**
 * Hook to subscribe to real-time task updates.
 * Roots: use-task.ts keys on ['tasks', projectId], ['workspace-tasks', wsId],
 * ['task', taskId] and ['tasks','functional-requirement',frId] (covered by the
 * 'tasks' prefix). `projectId` still gates the subscription, but it cannot
 * narrow the invalidation — the realtime channel is per-collection, not
 * per-project, so an event carries no project scope to filter on.
 */
export function useTasksRealtime(projectId?: string) {
  useCollectionSubscription(COLLECTIONS.TASKS, ['tasks', 'workspace-tasks', 'task'], !!projectId);
}

/**
 * Hook to subscribe to real-time notification updates
 */
/**
 * Hook to subscribe to real-time sprint updates.
 * Roots: use-sprint.ts keys on ['sprints', projectId],
 * ['workspace-sprints', wsId], ['sprint', sprintId] and ['sprint','active',id].
 */
export function useSprintsRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.SPRINTS,
    ['sprints', 'workspace-sprints', 'sprint'],
    !!projectId
  );
}

/**
 * Hook to subscribe to real-time project updates.
 * Roots: use-project.ts keys on ['projects', …] and ['project', projectId].
 */
export function useProjectsRealtime(workspaceId?: string) {
  useCollectionSubscription(COLLECTIONS.PROJECTS, ['projects', 'project'], !!workspaceId);
}

/**
 * Task comments, so a teammate's reply appears in an open task without a
 * refresh. Root: use-task-comment.ts keys on ['task-comments', taskId].
 * Mounted by the TaskComments component itself, which is the only reader.
 */
export function useTaskCommentsRealtime(taskId?: string) {
  useCollectionSubscription(COLLECTIONS.TASK_COMMENTS, ['task-comments'], !!taskId);
}

/**
 * Hook to subscribe to real-time leave request updates.
 * Roots: use-leave.ts keys on ['leaveRequests', …], ['teamLeaveRequests', …] and
 * ['leaveBalance', …] — camelCase, all three. Not yet mounted by any page; see
 * the note in the module header.
 */
export function useLeaveRequestsRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.LEAVE_REQUESTS,
    ['leaveRequests', 'teamLeaveRequests', 'leaveBalance'],
    !!workspaceId
  );
}

/**
 * Hook to subscribe to real-time attendance updates.
 * Roots: use-attendance.ts keys on ['attendance', …]; use-team-attendance.ts on
 * ['teamAttendance', …] and ['teamAttendanceRange', …].
 */
export function useAttendanceRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.ATTENDANCE,
    ['attendance', 'teamAttendance', 'teamAttendanceRange'],
    !!workspaceId
  );
}
