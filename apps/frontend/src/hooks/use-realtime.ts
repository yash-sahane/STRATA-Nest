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
  // 'member-task-counts' too: the assignee picker on this board ranks people
  // by their open tasks, and an assignment made here moved those numbers.
  useCollectionSubscription(
    COLLECTIONS.TASKS,
    ['tasks', 'workspace-tasks', 'task', 'member-task-counts'],
    !!projectId
  );
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
    // Every query a decided or cancelled request changes the answer to.
    ['leaveRequests', 'teamLeaveRequests', 'leaveBalance', 'leaveCommitments', 'teamLeaveBalances'],
    !!workspaceId
  );
  // And the balances themselves: an approver adjusting somebody's allowance
  // writes leave_balances, which nothing on the Leave page heard.
  useCollectionSubscription(
    COLLECTIONS.LEAVE_BALANCES,
    ['leaveBalance', 'teamLeaveBalances'],
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

/**
 * Epics.
 *
 * Roots: use-epic keys on ['epics', projectId] and ['epic', epicId]; an epic
 * write also shifts the requirement and task rollups the same hook invalidates,
 * so those go too.
 *
 * There was no epics subscription at all, though the server has always broadcast
 * them — so an epic deleted by a teammate stayed on an open /epics page and
 * clicking its card then failed against a record that no longer existed.
 */
export function useEpicsRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.EPICS,
    ['epics', 'epic', 'functional-requirements', 'tasks'],
    !!projectId
  );
}

/**
 * Client requirements.
 * Roots: use-client-requirement keys on ['client-requirements', …] and
 * ['client-requirement', id], and a requirement write moves its FR/epic rollups.
 */
export function useClientRequirementsRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.CLIENT_REQUIREMENTS,
    ['client-requirements', 'client-requirement', 'functional-requirements', 'epics'],
    !!projectId
  );
}

/**
 * Functional requirements.
 * Roots: use-functional-requirement keys on ['functional-requirements', …],
 * ['functional-requirement', id], plus the epic/task links it invalidates.
 */
export function useFunctionalRequirementsRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.FUNCTIONAL_REQUIREMENTS,
    ['functional-requirements', 'functional-requirement', 'epics', 'tasks'],
    !!projectId
  );
}

/**
 * Time entries and the running timer.
 * Roots: use-time-entry keys on ['time-entries', …] and ['active-timer', …]. The
 * timer matters most: started on one device it was invisible on another until a
 * manual refresh.
 */
export function useTimeEntriesRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.TIME_ENTRIES,
    ['time-entries', 'active-timer'],
    !!workspaceId
  );
}

/**
 * Uploaded files. Root: use-file keys on ['files', …].
 */
export function useFilesRealtime(workspaceId?: string) {
  useCollectionSubscription(COLLECTIONS.FILES, ['files'], !!workspaceId);
}

/**
 * The activity feed. Root: activity-feed keys on ['activity-logs', workspaceId].
 * An audit trail that only updates on refresh is the one list where being live
 * is the entire point.
 */
export function useActivityLogsRealtime(workspaceId?: string) {
  useCollectionSubscription(COLLECTIONS.ACTIVITY_LOGS, ['activity-logs'], !!workspaceId);
}

/**
 * The caller's own running timer — started, paused or stopped in another tab
 * or on another device. Root: use-time-entry keys it on ['active-timer', id].
 */
export function useActiveTimerRealtime(userId?: string) {
  useCollectionSubscription(COLLECTIONS.ACTIVE_TIMERS, ['active-timer'], !!userId);
}

/**
 * What the caller may DO, kept current.
 *
 * Everything the interface offers is decided from two cached answers: the
 * caller's own memberships (which role, where) and the definitions of any
 * custom roles they hold. Both were fetched once and trusted for five minutes.
 * So when a manager changed somebody's role, or edited what a role may do, the
 * person it concerned went on seeing the old set of buttons — pressing ones the
 * API now refused, missing ones it would now allow — until the cache happened
 * to expire or they reloaded.
 *
 * Mounted once for the whole dashboard (see the layout), not per page: a role
 * can change while its holder is looking at anything.
 */
export function useMyAccessRealtime(enabled = true) {
  // The workspace list and the directory too: a membership switched off or
  // removed left the switcher naming a workspace whose pages now refused the
  // person, and one added elsewhere did not appear until a reload. And the
  // inbox, where the notice saying why is.
  useCollectionSubscription(
    COLLECTIONS.WORKSPACE_MEMBERS,
    ['my-access', 'workspaces', 'workspace-directory', 'notifications'],
    enabled
  );
  useCollectionSubscription(
    COLLECTIONS.WORKSPACE_ROLES,
    // A rename moves every holder to the new name in one write the role's own
    // frame does not describe; reading the memberships again keeps their role.
    ['my-access', 'workspace-roles', 'team-members'],
    enabled
  );
}

/**
 * Workspace membership.
 * Roots: use-team keys on ['team-members', wsId], ['team-member', id] and
 * ['member-task-counts', wsId] — the last one feeds both workload panels on
 * /team, so a member joining or leaving used to leave both of them stale.
 */
export function useWorkspaceMembersRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.WORKSPACE_MEMBERS,
    ['team-members', 'team-member', 'member-task-counts'],
    !!workspaceId
  );
}

/**
 * Every task in the workspace, as the Team page counts them: its workload
 * panels and per-member counts. Roots: ['workspace-tasks', wsId] and
 * ['member-task-counts', wsId].
 */
export function useWorkspaceTasksRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.TASKS,
    ['workspace-tasks', 'member-task-counts'],
    !!workspaceId
  );
}

/** The join-request queue. Roots: ['join-requests', wsId, status]. */
export function useJoinRequestsRealtime(workspaceId?: string) {
  useCollectionSubscription(COLLECTIONS.JOIN_REQUESTS, ['join-requests'], !!workspaceId);
}
