import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resources } from '@/lib/api/client';
import { query } from '@/lib/api/client';
import { restClient } from '@/lib/api/rest-client';
import type { Notification } from '@/types';
import { toast } from 'sonner';

/**
 * The full notification list (50 most recent).
 *
 * `enabled` exists because this list is only ever read inside the notification
 * dropdown, which is closed on arrival. Fetching it eagerly meant every full
 * page load pulled 50 rows nobody looked at; the unread count the badge needs
 * comes from `useUnreadNotifications`, which stays eager.
 */
export function useNotifications(userId?: string, enabled = true, limit = 50) {
  return useQuery({
    queryKey: ['notifications', userId, limit],
    queryFn: async () => {
      if (!userId) return [];

      const response = await resources.list('notifications', [
        query.equal('userId', userId),
        query.orderDesc('createdAt'),
        query.limit(limit),
      ]);

      return response.items as unknown as Notification[];
    },
    enabled: !!userId && enabled,
    // "Show older" asks for a longer page under a new key; keep the rows already
    // shown while it loads, rather than blanking the list back to skeletons.
    placeholderData: keepPreviousData,
  });
}

/**
 * How many notifications the person has in all — the list shows the newest page
 * only, and "Clear all" deletes every one, so both need the real number.
 */
export function useNotificationCount(userId?: string, enabled = true) {
  return useQuery({
    queryKey: ['notifications', 'count', userId],
    queryFn: async () => {
      if (!userId) return 0;
      const response = await resources.list('notifications', [
        query.equal('userId', userId),
        query.limit(1),
      ]);
      return (response as { total?: number }).total ?? response.items.length;
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
type PreferencesResponse = { items?: NotificationPreferenceRecord[] } | null;

/** The caller's own delivery toggles. Rows are recipient-private server-side —
 *  there is no way to read or write anybody else's. */
export function useNotificationPreferences(workspaceId?: string) {
  return useQuery({
    queryKey: ['notification-preferences', workspaceId],
    queryFn: async () => {
      const response = await restClient.get<PreferencesResponse>(PREFERENCES_PATH, {
        params: { workspaceId },
      });
      return response?.items ?? [];
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
      const response = await restClient.put<PreferencesResponse>(PREFERENCES_PATH, {
        workspaceId,
        preferences,
      });
      return { workspaceId, items: response?.items ?? [] };
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
    onSuccess: () => {
      // The root: the list's pages, the unread badge and the total all start with it.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error: unknown) => {
      toast.error('Failed to mark notification as read', { description: error instanceof Error ? error.message : String(error) });
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
    onSuccess: () => {
      // The root: the list's pages, the unread badge and the total all start
      // with it, and a bulk write sends no per-row frame to refresh them.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    },
    onError: (error: unknown) => {
      toast.error('Failed to mark notifications as read', { description: error instanceof Error ? error.message : String(error) });
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
    onSuccess: () => {
      // The root: the list's pages, the unread badge and the total all start with it.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notification deleted');
    },
    onError: (error: unknown) => {
      toast.error('Failed to delete notification', { description: error instanceof Error ? error.message : String(error) });
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
    onSuccess: () => {
      // The root: the list's pages, the unread badge and the total all start
      // with it, and a bulk write sends no per-row frame to refresh them.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications cleared');
    },
    onError: (error: unknown) => {
      toast.error('Failed to clear notifications', { description: error instanceof Error ? error.message : String(error) });
    },
  });
}
