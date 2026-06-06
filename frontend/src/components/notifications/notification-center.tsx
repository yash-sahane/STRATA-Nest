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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
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

interface NotificationItemProps {
  notification: Notification;
  onDelete: (id: string) => void;
  onClick: (notification: Notification) => void;
}

function NotificationItem({ notification, onDelete, onClick }: NotificationItemProps) {
  const Icon = getNotificationIcon(notification.type);
  const iconColor = getNotificationColor(notification.type);

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg transition-colors cursor-pointer hover:bg-accent group relative',
        !notification.isRead && 'bg-blue-50/50 dark:bg-blue-950/20'
      )}
      onClick={() => onClick(notification)}
    >
      {/* Close button - always visible on hover */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(notification.id);
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>

      <div className={cn('mt-1', iconColor)}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1 space-y-1 min-w-0 pr-6">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{notification.title}</p>
          {!notification.isRead && (
            <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1" />
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{notification.message}</p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: unreadNotifications } = useUnreadNotifications(user?.id);
  const { data: allNotifications } = useNotifications(user?.id);
  const markAsRead = useMarkNotificationAsRead();
  const markAllAsRead = useMarkAllNotificationsAsRead();
  const deleteNotification = useDeleteNotification();
  const deleteAllNotifications = useDeleteAllNotifications();

  const [open, setOpen] = React.useState(false);

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
          queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
          queryClient.invalidateQueries({ queryKey: ['unread-notifications', user.id] });

          // Show toast for new notifications
          if (eventType === 'create') {
            toast({
              title: 'New Notification',
              description: payload.title || 'You have a new notification',
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
    const allIds = allNotifications.map((n) => n.id);
    await deleteAllNotifications.mutateAsync({ userId: user.id, notificationIds: allIds });
  };

  /**
   * Get navigation URL based on notification type and related entity
   */
  const getNavigationUrl = (notification: Notification): string | null => {
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
        return `/frs?projectId=${projectId}&frId=${relatedEntityId}`;
      }
      return '/frs';
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
            ? `/frs?projectId=${projectId}&frId=${relatedEntityId}`
            : '/frs';
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
  };

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }

    // Navigate based on notification type
    const url = getNavigationUrl(notification);
    if (url) {
      router.push(url);
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-95 p-0">
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
            {allNotifications && allNotifications.length > 0 && unreadCount === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteAll}
                disabled={deleteAllNotifications.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear all
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="h-100">
          <div className="p-2 space-y-1">
            {allNotifications && allNotifications.length > 0 ? (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
