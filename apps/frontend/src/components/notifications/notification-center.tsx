'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToCollection, getRealtimeEventType, REALTIME_CONFIG } from '@/lib/api/realtime';
import type { ApiModels } from '@/lib/api/client';
import {
  useUnreadNotifications,
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useDeleteNotification,
  useDeleteAllNotifications,
} from '@/hooks/use-notification';
import { useConfirm } from '@/components/providers/confirm-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RowActivator } from '@/components/ui/row-activator';
/**
 * A Popover, NOT a DropdownMenu.
 *
 * Radix's DropdownMenu is a `role="menu"` with roving focus: it moves focus
 * between its `role="menuitem"` children and swallows every other key. This
 * panel has no menuitems — it has 50 notification rows, each with its own
 * delete button, plus "Mark all read". So the menu opened, focus landed on the
 * container, and NOTHING moved it: 102 focusable controls inside and not one
 * key (arrows, Home/End, Tab, letters) could reach any of them. A popover is
 * what this actually is — a panel of rich content — and it gives back the
 * ordinary tab order, Escape-to-close and focus-return-to-trigger.
 */
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  X,
  MessageSquare,
  Calendar,
  CheckCircle2,
  AlertCircle,
  GitBranch,
  ClipboardCheck,
  Flag,
  Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Notification, NotificationType } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const getNotificationIcon = (type: NotificationType) => {
  switch (type) {
    case 'TASK_ASSIGNED':
    case 'TASK_UPDATED':
      return CheckCircle2;
    case 'TASK_REVIEW_REQUESTED':
      return ClipboardCheck;
    case 'TASK_REVIEWED_DONE':
      return CheckCircle2;
    case 'SPRINT_READY_TO_CLOSE':
      return Flag;
    case 'TASK_COMMENT':
    case 'MENTION':
      return MessageSquare;
    case 'SPRINT_EVENT':
      return GitBranch;
    case 'LEAVE_REQUEST':
    case 'LEAVE_APPROVED':
    case 'LEAVE_REJECTED':
      return Calendar;
    case 'ATTENDANCE_ALERT':
      return AlertCircle;
    default:
      return Bell;
  }
};

const getNotificationColor = (type: NotificationType) => {
  switch (type) {
    case 'TASK_ASSIGNED':
      return 'text-blue-500';
    case 'TASK_REVIEW_REQUESTED':
      return 'text-purple-500';
    case 'TASK_REVIEWED_DONE':
      return 'text-green-500';
    case 'SPRINT_READY_TO_CLOSE':
      return 'text-green-500';
    case 'TASK_COMMENT':
    case 'MENTION':
      return 'text-purple-500';
    case 'SPRINT_EVENT':
      return 'text-green-500';
    case 'LEAVE_APPROVED':
      return 'text-green-500';
    case 'LEAVE_REJECTED':
    case 'ATTENDANCE_ALERT':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
};

/**
 * Where a notification leads, or null when its type has no destination.
 *
 * At module scope on purpose: it reads nothing but its argument, and the row
 * needs the answer in order to decide whether to present itself as clickable
 * at all. While this lived inside the component the row could not ask, so
 * every row was role="button" with a pointer cursor whether or not there was
 * anywhere to go.
 */
function navigationUrlFor(notification: Notification): string | null {
  const { type, relatedEntityType, relatedEntityId, projectId } = notification;

  // Task-related notifications
  if (
    type.startsWith('TASK_') ||
    type === 'COMMENT_MENTION' ||
    type === 'COMMENT_REPLY' ||
    type === 'COMMENT_ON_TASK'
  ) {
    if (projectId && relatedEntityId) {
      return `/tasks?projectId=${projectId}&taskId=${relatedEntityId}`;
    }
    return '/tasks';
  }

  // Sprint-related notifications
  if (type.startsWith('SPRINT_')) {
    if (relatedEntityId) {
      return `/sprints/${relatedEntityId}/board`;
    }
    return '/sprints';
  }

  // Epic-related notifications
  if (type.startsWith('EPIC_')) {
    if (projectId && relatedEntityId) {
      return `/epics?projectId=${projectId}&epicId=${relatedEntityId}`;
    }
    return '/epics';
  }

  // FR (Functional Requirement) notifications
  if (type.startsWith('FR_')) {
    if (projectId && relatedEntityId) {
      return `/functional-requirements?projectId=${projectId}&frId=${relatedEntityId}`;
    }
    return '/functional-requirements';
  }

  // Requirement notifications
  if (type.startsWith('REQUIREMENT_')) {
    if (projectId) {
      return `/requirements?projectId=${projectId}`;
    }
    return '/requirements';
  }

  // Leave-related notifications
  if (type.startsWith('LEAVE_')) {
    return '/leave';
  }

  // Attendance-related notifications
  if (type.startsWith('ATTENDANCE_')) {
    return '/attendance';
  }

  // Team/Project notifications
  if (type === 'TEAM_MEMBER_ADDED' || type === 'PROJECT_INVITATION') {
    if (projectId) {
      return `/projects/${projectId}`;
    }
    return '/projects';
  }

  // Fallback based on relatedEntityType
  if (relatedEntityType) {
    switch (relatedEntityType) {
      case 'TASK':
        return projectId && relatedEntityId
          ? `/tasks?projectId=${projectId}&taskId=${relatedEntityId}`
          : '/tasks';
      case 'SPRINT':
        return relatedEntityId ? `/sprints/${relatedEntityId}/board` : '/sprints';
      case 'EPIC':
        return projectId && relatedEntityId
          ? `/epics?projectId=${projectId}&epicId=${relatedEntityId}`
          : '/epics';
      case 'FR':
        return projectId && relatedEntityId
          ? `/functional-requirements?projectId=${projectId}&frId=${relatedEntityId}`
          : '/functional-requirements';
      case 'LEAVE':
        return '/leave';
      case 'ATTENDANCE':
        return '/attendance';
      case 'PROJECT':
        return projectId ? `/projects/${projectId}` : '/projects';
      default:
        return null;
    }
  }

  return null;
}

interface NotificationItemProps {
  notification: Notification;
  onDelete: (id: string) => void;
  onClick: (notification: Notification) => void;
}

function NotificationItem({ notification, onDelete, onClick }: NotificationItemProps) {
  const Icon = getNotificationIcon(notification.type);
  const iconColor = getNotificationColor(notification.type);

  // What activating this row would actually DO. A notification whose type has no
  // destination and which is already read has no effect at all on click, and used
  // to be role="button" with a pointer cursor and a hover highlight regardless.
  const destination = navigationUrlFor(notification);
  const doesSomething = Boolean(destination) || !notification.isRead;
  const actionLabel = destination
    ? `Open: ${notification.title}`
    : `Mark as read: ${notification.title}`;

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg transition-colors group relative',
        // Only claim to be clickable when activating it does something.
        doesSomething && 'cursor-pointer hover:bg-accent',
        !notification.isRead && 'bg-blue-50/50 dark:bg-blue-950/20'
      )}
      // NOT role="button". This row contains the delete button below it, and an
      // interactive ancestor of an interactive element is what axe reports as
      // nested-interactive — 28 of them in one open popover. The keyboard
      // contract lives on the row's title instead, as a SIBLING of that button.
      onClick={doesSomething ? () => onClick(notification) : undefined}
    >
      <div className={cn('mt-1', iconColor)} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1 space-y-1 min-w-0 pr-6">
        <div className="flex items-start justify-between gap-2">
          {doesSomething ? (
            <RowActivator
              label={actionLabel}
              onActivate={() => onClick(notification)}
              className="text-sm font-medium leading-tight min-w-0 flex-1"
            >
              {notification.title}
            </RowActivator>
          ) : (
            <p className="text-sm font-medium leading-tight">{notification.title}</p>
          )}
          {!notification.isRead && (
            <div
              className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1"
              // The dot is the only thing that distinguishes unread from read, so
              // it is not decoration and needs a name.
              role="img"
              aria-label="Unread"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>

      {/* Absolutely positioned, so it sits top-right whatever its DOM position —
          and placing it AFTER the row's content puts it where a keyboard user
          expects it: row, then that row's delete, then the next row. Only
          opacity-0 for the mouse; `focus-visible:opacity-100` keeps it visible
          for keyboard users, who never trigger the group hover. */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete notification: ${notification.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(notification.id);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * NOT memoised, deliberately — this was tried and reverted.
 *
 * The unread query fires twice on a full page load, and memoising this
 * component does remove the second request. But the second request is the one
 * whose result is KEPT: React Query cancels the first when the observer
 * re-reads its options, discards that response even though it arrives, and
 * relies on the refetch to populate the cache. With the re-render suppressed no
 * refetch happens, the badge silently stays empty, and the count never appears.
 *
 * So the duplicate is not removable from this end. Anything attacking it has to
 * stop the first fetch being cancelled, and must be checked against the badge
 * actually rendering a count — not just against the request count going down.
 */
export function NotificationCenter() {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: unreadNotifications } = useUnreadNotifications(user?.id);
  const markAsRead = useMarkNotificationAsRead();
  const markAllAsRead = useMarkAllNotificationsAsRead();
  const deleteNotification = useDeleteNotification();
  const deleteAllNotifications = useDeleteAllNotifications();
  const confirm = useConfirm();

  const [open, setOpen] = React.useState(false);
  // Only the badge count is needed until the menu is opened, so the 50-row list
  // is deferred until there is something to show it in.
  const {
    data: allNotifications,
    isLoading: notificationsLoading,
    isError: notificationsError,
    refetch: refetchNotifications,
  } = useNotifications(user?.id, open);

  // Real-time subscription for notifications
  React.useEffect(() => {
    if (!user?.id) return;

    const subscription = subscribeToCollection(
      REALTIME_CONFIG.COLLECTIONS.NOTIFICATIONS,
      (response: ApiModels.RealtimeEvent<Record<string, unknown>>) => {
        const eventType = getRealtimeEventType(response.event);
        const payload = response.payload as any;

        // Only process notifications for this user
        if (payload.userId === user.id) {
          // Prefix match: covers both ['notifications', userId] and
          // ['notifications', 'unread', userId] — the unread badge is keyed with
          // 'unread' at index 1, so ['notifications', userId] never matched it.
          queryClient.invalidateQueries({ queryKey: ['notifications'] });

          // Show toast for new notifications
          if (eventType === 'create') {
            // 'info', not the default: this is an inbound announcement, not a
            // confirmation of something the viewer did, and payload.title can
            // read 'Leave Request Rejected' — which must not land on a green
            // success card (the shim maps 'default' to sonnerToast.success).
            toast({
              title: 'New Notification',
              description: payload.title || 'You have a new notification',
              variant: 'info',
            });
          }
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [user?.id, queryClient]);

  const unreadCount = unreadNotifications?.length || 0;

  const handleMarkAsRead = async (notificationId: string) => {
    if (!user) return;
    await markAsRead.mutateAsync({ notificationId, userId: user.id });
  };

  const handleMarkAllAsRead = async () => {
    if (!user || !unreadNotifications || unreadNotifications.length === 0) return;

    const unreadIds = unreadNotifications.map((n) => n.id);
    await markAllAsRead.mutateAsync({ userId: user.id, notificationIds: unreadIds });
  };

  const handleDelete = async (notificationId: string) => {
    if (!user) return;
    await deleteNotification.mutateAsync({ notificationId, userId: user.id });
  };

  const handleDeleteAll = async () => {
    if (!user || !allNotifications || allNotifications.length === 0) return;
    const unread = allNotifications.filter((n) => !n.isRead).length;
    const confirmed = await confirm({
      title: 'Clear all notifications?',
      description:
        `This permanently deletes all ${allNotifications.length} notifications` +
        (unread > 0 ? `, including ${unread} you haven't read` : '') +
        ", and can't be undone.",
      confirmText: 'Clear all',
      destructive: true,
    });
    if (!confirmed) return;
    const allIds = allNotifications.map((n) => n.id);
    await deleteAllNotifications.mutateAsync({ userId: user.id, notificationIds: allIds });
  };

  /**
   * Get navigation URL based on notification type and related entity
   */

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }

    // Navigate based on notification type
    const url = navigationUrlFor(notification);
    if (url) {
      router.push(url);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          // Icon-only trigger: without this a screen reader announces just
          // "button", and the unread count in the badge is decorative markup.
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-95 p-0" aria-label="Notifications">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Notifications</h3>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
              >
                <CheckCheck className="h-4 w-4 mr-1" />
                Mark all read
              </Button>
            )}
            {/* No `unreadCount === 0` here any more. Gating this on everything
                having been read meant the only route to "Clear all" was to press
                "Mark all read" first — two steps for one intention, and nothing
                about deleting a notification requires having read it. The
                confirmation says how many are unread, so the destructive action
                still states what it is about to destroy. */}
            {allNotifications && allNotifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteAll}
                disabled={deleteAllNotifications.isPending}
                className="text-destructive-text hover:text-destructive-text"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-100">
          <div className="p-2 space-y-1">
            {/* The list is deferred until the panel opens, so on the FIRST open
                it is genuinely still loading — and rendering the empty state
                then told the user they were "all caught up" while the bell
                beside it showed an unread count. */}
            {notificationsLoading ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 p-3">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notificationsError ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive-text" />
                <p className="text-sm font-medium">Couldn&apos;t load notifications</p>
                <Button variant="outline" size="sm" onClick={() => void refetchNotifications()}>
                  Try again
                </Button>
              </div>
            ) : allNotifications && allNotifications.length > 0 ? (
              allNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onDelete={handleDelete}
                  onClick={handleNotificationClick}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs text-muted-foreground mt-1">You&apos;re all caught up!</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
