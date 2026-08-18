import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query, id } from '@/lib/api/client';
import type { Notification, NotificationType } from '@/types';
import { toast } from '@/hooks/use-toast';
import { generateNotification, shouldSendEmail } from '@/lib/notification-utils';
import { logger } from '@/lib/logger';

export function useNotifications(userId?: string) {
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
    enabled: !!userId,
  });
}

export function useUnreadNotifications(userId?: string) {
  return useQuery({
    queryKey: ['notifications', 'unread', userId],
    queryFn: async () => {
      if (!userId) return [];

      const response = await resources.list('notifications', [
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
      relatedEntityId?: string;
      relatedEntityType?: 'TASK' | 'SPRINT' | 'LEAVE' | 'ATTENDANCE';
      actionUrl?: string;
    }) => {
      const response = await resources.create('notifications', id.unique(),
        {
          workspaceId: data.workspaceId,
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message,
          relatedEntityId: data.relatedEntityId || '',
          relatedEntityType: data.relatedEntityType || '',
          actionUrl: data.actionUrl || '',
          isRead: false,
        }
      );

      return response as unknown as Notification;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', data.userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread', data.userId] });
    },
    onError: (error: unknown) => {
      logger.error('Failed to create notification', { error });
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
    mutationFn: async ({
      userId,
      notificationIds,
    }: {
      userId: string;
      notificationIds: string[];
    }) => {
      // Update all notifications in parallel
      await Promise.all(
        notificationIds.map((id) =>
          resources.update('notifications', id, { isRead: true })
        )
      );

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
    mutationFn: async ({
      userId,
      notificationIds,
    }: {
      userId: string;
      notificationIds: string[];
    }) => {
      // Delete all notifications in parallel
      await Promise.all(
        notificationIds.map((id) =>
          resources.remove('notifications', id)
        )
      );

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
        relatedEntityId: data.taskId || data.sprintId || data.leaveId || '',
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

        // Send email notification via API route
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
          }),
        });
      } catch (error) {
        // Don't fail notification creation if email fails
        logger.error('Failed to send notification email', { error });
      }
    }

    return notification as unknown as Notification;
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

