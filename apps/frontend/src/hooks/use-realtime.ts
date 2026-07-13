import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  subscribeToCollection,
  getRealtimeEventType,
  isRealtimeEvent,
} from '@/lib/api/realtime';
import { COLLECTIONS } from '@/lib/api/config';
import type { ApiModels } from '@/lib/api/client';
import { logger } from '@/lib/logger';

/**
 * Hook to subscribe to real-time updates for a collection
 * Automatically invalidates React query cache on changes
 */
export function useCollectionSubscription(
  collectionId: string,
  queryKeys: string[],
  enabled: boolean = true
) {
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

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

        // Invalidate all related queries
        queryKeys.forEach(key => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      }
    );

    return () => {
      logger.debug(`Unsubscribing from collection: ${collectionId}`);
      subscriptionRef.current?.unsubscribe();
    };
  }, [collectionId, enabled, queryClient, queryKeys]);
}

/**
 * Hook to subscribe to real-time task updates
 */
export function useTasksRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.TASKS,
    ['tasks', projectId ? `tasks-${projectId}` : ''].filter(Boolean),
    !!projectId
  );
}

/**
 * Hook to subscribe to real-time comment updates
 */
export function useCommentsRealtime(taskId?: string) {
  useCollectionSubscription(
    COLLECTIONS.TASK_COMMENTS,
    ['comments', taskId ? `comments-${taskId}` : ''].filter(Boolean),
    !!taskId
  );
}

/**
 * Hook to subscribe to real-time notification updates
 */
export function useNotificationsRealtime(userId?: string) {
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;

    logger.debug(`Subscribing to notifications for user: ${userId}`);

    subscriptionRef.current = subscribeToCollection(
      COLLECTIONS.NOTIFICATIONS,
      (response: ApiModels.RealtimeEvent<Record<string, unknown>>) => {
        // Only process if notification is for this user
        if (response.payload.userId !== userId) return;

        const eventType = getRealtimeEventType(response.event);
        logger.debug('Notification event', {
          type: eventType,
          notificationId: response.payload.id,
        });

        // Invalidate notification queries
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['unread-count'] });

        // Show toast for new notifications
        if (isRealtimeEvent(response, 'create')) {
          // Will be handled by notification center component
        }
      }
    );

    return () => {
      logger.debug('Unsubscribing from notifications');
      subscriptionRef.current?.unsubscribe();
    };
  }, [userId, queryClient]);
}

/**
 * Hook to subscribe to real-time sprint updates
 */
export function useSprintsRealtime(projectId?: string) {
  useCollectionSubscription(
    COLLECTIONS.SPRINTS,
    ['sprints', projectId ? `sprints-${projectId}` : ''].filter(Boolean),
    !!projectId
  );
}

/**
 * Hook to subscribe to real-time project updates
 */
export function useProjectsRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.PROJECTS,
    ['projects', workspaceId ? `projects-${workspaceId}` : ''].filter(Boolean),
    !!workspaceId
  );
}

/**
 * Hook to subscribe to real-time leave request updates
 */
export function useLeaveRequestsRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.LEAVE_REQUESTS,
    ['leave-requests', workspaceId ? `leave-requests-${workspaceId}` : ''].filter(Boolean),
    !!workspaceId
  );
}

/**
 * Hook to subscribe to real-time attendance updates
 */
export function useAttendanceRealtime(workspaceId?: string) {
  useCollectionSubscription(
    COLLECTIONS.ATTENDANCE,
    ['attendance', workspaceId ? `attendance-${workspaceId}` : ''].filter(Boolean),
    !!workspaceId
  );
}
