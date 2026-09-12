import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type { Notification, NotificationType } from '@/types';
import { toast } from '@/hooks/use-toast';
import { generateNotification, shouldSendEmail } from '@/lib/notification-utils';
import { logger } from '@/lib/logger';

/**
 * The full notification list (50 most recent).
 *
 * `enabled` exists because this list is only ever read inside the notification
 * dropdown, which is closed on arrival. Fetching it eagerly meant every full
 * page load pulled 50 rows nobody looked at; the unread count the badge needs
 * comes from `useUnreadNotifications`, which stays eager.
 */
export function useNotifications(userId?: string, enabled = true) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      if (!userId) return [];

      const response = await resources.list('notifications', [
        query.equal('userId', userId),
        query.orderDesc('createdAt'),
        query.limit(50),
      ]);

      return response.items as unknown as Notification[];
    },
    enabled: !!userId && enabled,
  });
}

export function useUnreadNotifications(userId?: string) {
  return useQuery({
    queryKey: ['notifications', 'unread', userId],
    queryFn: async () => {
      if (!userId) return [];

      // listAll: this list feeds "Mark all read", which sends exactly the ids it
      // holds. Capped at the default 100-row page, a user with more unread than
      // that pressed it, watched the badge drop, and still had unread rows.
      const response = await resources.listAll('notifications', [
        query.equal('userId', userId),
        query.equal('isRead', false),
        query.orderDesc('createdAt'),
      ]);

      return response.items as unknown as Notification[];
    },
    enabled: !!userId,
  });
}

export function useCreateNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      workspaceId: string;
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      projectId?: string;
      relatedEntityId?: string;
      relatedEntityType?: 'TASK' | 'SPRINT' | 'LEAVE' | 'ATTENDANCE';
    }) => {
      // No `actionUrl`: the Notification model has no such column, so the API's
      // whitelist validation strips it — the navigation URL is derived from
      // type/projectId/relatedEntityId by the notification center instead.
      const response = await resources.create('notifications', id.unique(),
        {
          workspaceId: data.workspaceId,
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          projectId: data.projectId || '',
          relatedEntityId: data.relatedEntityId || '',
          relatedEntityType: data.relatedEntityType || '',
          isRead: false,
        }
      );

      // `null` = the recipient muted this type in-app; the server persisted
      // nothing and returned an empty body.
      return (response ?? null) as Notification | null;
    },
    onSuccess: (data) => {
      if (!data) return;
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
    },
    onError: (error: unknown) => {
      logger.error('Failed to create notification', { error });
    },
  });
}

// ============================================================================
// Delivery preferences (Settings → Notifications)
// ============================================================================

export interface NotificationPreferenceRecord {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  inApp: boolean;
  email: boolean;
}

const PREFERENCES_PATH = '/api/v1/notification_preferences/';

/** The caller's own delivery toggles. Rows are recipient-private server-side —
 *  there is no way to read or write anybody else's. */
export function useNotificationPreferences(workspaceId?: string) {
  return useQuery({
    queryKey: ['notification-preferences', workspaceId],
    queryFn: async () => {
      const response = await restClient.get(PREFERENCES_PATH, { params: { workspaceId } });
      return (response?.items ?? []) as NotificationPreferenceRecord[];
    },
    enabled: !!workspaceId,
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workspaceId,
      preferences,
    }: {
      workspaceId: string;
      preferences: Array<{ type: string; inApp: boolean; email: boolean }>;
    }) => {
      const response = await restClient.put(PREFERENCES_PATH, { workspaceId, preferences });
      return { workspaceId, items: (response?.items ?? []) as NotificationPreferenceRecord[] };
    },
    onSuccess: ({ workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', workspaceId] });
    },
  });
}

export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ notificationId, userId }: { notificationId: string; userId: string }) => {
      const response = await resources.update('notifications', notificationId,
        { isRead: true }
      );

      return { notification: response as unknown as Notification, userId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to mark notification as read',
        variant: 'destructive',
      });
    },
  });
}

export function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    // ONE request. This used to PATCH every id in the list, and each write's
    // realtime echo re-invalidated both notification queries, so a single click
    // cost 38 requests for 12 unread and scaled linearly with the inbox. The
    // API has had a single-shot endpoint for this all along.
    //
    // `notificationIds` is still accepted so callers need not change, but the
    // server decides what is unread — the browser's idea of it can be stale.
    mutationFn: async ({ userId }: { userId: string; notificationIds?: string[] }) => {
      await restClient.post('/api/v1/notifications/mark_all_read/', {});
      return { userId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
      toast({
        title: 'All notifications marked as read',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to mark notifications as read',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ notificationId, userId }: { notificationId: string; userId: string }) => {
      await resources.remove('notifications', notificationId);
      return { userId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
      toast({
        title: 'Notification deleted',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to delete notification',
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteAllNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    // One request, same reasoning as mark-all-read above.
    mutationFn: async ({ userId }: { userId: string; notificationIds?: string[] }) => {
      await restClient.delete('/api/v1/notifications/');
      return { userId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
      toast({
        title: 'All notifications cleared',
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to clear notifications',
        variant: 'destructive',
      });
    },
  });
}

// ============================================================================
// Helper Functions for Creating Notifications
// ============================================================================

/**
 * Create a notification using templates
 * This simplifies notification creation throughout the app
 */
export async function createNotificationFromTemplate({
  workspaceId,
  userId,
  type,
  data,
}: {
  workspaceId: string;
  userId: string;
  type: string;
  data: any;
}): Promise<Notification | null> {
  const notifContent = generateNotification(type, data);

  if (!notifContent) {
    logger.error('Failed to generate notification for type', { type });
    return null;
  }

  try {
    const notification = await resources.create('notifications', id.unique(),
      {
        workspaceId,
        userId,
        type,
        title: notifContent.title,
        message: notifContent.message,
        // projectId + the entity id are what the notification center deep-links
        // with; every FR/epic template passes frId/epicId, so they must be part
        // of the fallback chain or the link degrades to the bare list route.
        projectId: data.projectId || '',
        relatedEntityId:
          data.taskId || data.sprintId || data.leaveId || data.frId || data.epicId || '',
        relatedEntityType: data.entityType || '',
        isRead: false,
      }
    );

    // Send email for critical notifications
    if (shouldSendEmail(type)) {
      try {
        // Get user email from database
        const user = await resources.get('users', userId
        );

        // Send email notification via API route. `workspaceId`/`type` travel with
        // it so the API can drop the mail when the RECIPIENT turned the email
        // channel off for this type — the actor's browser cannot read (and must
        // not be trusted with) somebody else's preferences.
        await fetch('/api/send-notification-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: (user as any).name || 'User',
            email: (user as any).email,
            notificationTitle: notifContent.title,
            notificationMessage: notifContent.message,
            workspaceId,
            notificationType: type,
          }),
        });
      } catch (error) {
        // Don't fail notification creation if email fails
        logger.error('Failed to send notification email', { error });
      }
    }

    // `null` when the recipient muted the type in-app: nothing was persisted.
    return (notification ?? null) as Notification | null;
  } catch (error) {
    logger.error('Failed to create notification', { error });
    return null;
  }
}

/**
 * Create multiple notifications for multiple users
 */
export async function createBulkNotifications({
  workspaceId,
  userIds,
  type,
  data,
}: {
  workspaceId: string;
  userIds: string | string[];
  type: string;
  data: any;
}): Promise<Notification[]> {
  // Ensure userIds is always an array
  const userIdsArray = Array.isArray(userIds)
    ? userIds
    : typeof userIds === 'string'
      ? [userIds]
      : [];

  // Filter out empty strings and duplicates
  const validUserIds = [
    ...new Set(userIdsArray.filter((id) => id && typeof id === 'string' && id.trim() !== '')),
  ];

  if (validUserIds.length === 0) {
    logger.warn('createBulkNotifications called with no valid user IDs');
    return [];
  }

  const notifications = await Promise.all(
    validUserIds.map((userId) =>
      createNotificationFromTemplate({
        workspaceId,
        userId,
        type,
        data,
      })
    )
  );

  return notifications.filter((n): n is Notification => n !== null);
}

