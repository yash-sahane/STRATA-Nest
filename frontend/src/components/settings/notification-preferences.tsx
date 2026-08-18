'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_TYPES,
  NotificationCategory,
} from '@/lib/notification-utils';
import { toast } from 'sonner';
import { Bell, Mail } from 'lucide-react';
import { logger } from '@/lib/logger';

interface NotificationPreference {
  type: string;
  inApp: boolean;
  email: boolean;
}

// Default preferences - all enabled
const getDefaultPreferences = (): Record<string, NotificationPreference> => {
  const prefs: Record<string, NotificationPreference> = {};

  Object.keys(NOTIFICATION_TEMPLATES).forEach((type) => {
    prefs[type] = {
      type,
      inApp: true,
      email: NOTIFICATION_TEMPLATES[type].requiresEmail,
    };
  });

  return prefs;
};

// Group notification types by category
const groupByCategory = () => {
  const groups: Record<NotificationCategory, string[]> = {
    [NotificationCategory.TASK]: [],
    [NotificationCategory.SPRINT]: [],
    [NotificationCategory.LEAVE]: [],
    [NotificationCategory.ATTENDANCE]: [],
    [NotificationCategory.COMMENT]: [],
    [NotificationCategory.TEAM]: [],
    [NotificationCategory.SYSTEM]: [],
  };

  Object.entries(NOTIFICATION_TEMPLATES).forEach(([type, template]) => {
    groups[template.category].push(type);
  });

  return groups;
};

const categoryLabels: Record<NotificationCategory, string> = {
  [NotificationCategory.TASK]: 'Task Notifications',
  [NotificationCategory.SPRINT]: 'Sprint Notifications',
  [NotificationCategory.LEAVE]: 'Leave Notifications',
  [NotificationCategory.ATTENDANCE]: 'Attendance Notifications',
  [NotificationCategory.COMMENT]: 'Comment Notifications',
  [NotificationCategory.TEAM]: 'Team Notifications',
  [NotificationCategory.SYSTEM]: 'System Notifications',
};

const categoryDescriptions: Record<NotificationCategory, string> = {
  [NotificationCategory.TASK]: 'Notifications about task assignments, status changes, and updates',
  [NotificationCategory.SPRINT]: 'Notifications about sprint lifecycle and milestones',
  [NotificationCategory.LEAVE]: 'Notifications about leave requests and approvals',
  [NotificationCategory.ATTENDANCE]: 'Notifications about attendance and check-ins',
  [NotificationCategory.COMMENT]: 'Notifications about comments and mentions',
  [NotificationCategory.TEAM]: 'Notifications about team updates and changes',
  [NotificationCategory.SYSTEM]: 'System-wide notifications and announcements',
};

// Human-readable labels for notification types
const notificationLabels: Record<string, string> = {
  [NOTIFICATION_TYPES.TASK_ASSIGNED]: 'Task Assignments',
  [NOTIFICATION_TYPES.TASK_STATUS_CHANGED]: 'Task Status Changes',
  [NOTIFICATION_TYPES.TASK_PRIORITY_CHANGED]: 'Task Priority Changes',
  [NOTIFICATION_TYPES.TASK_COMPLETED]: 'Task Completions',
  [NOTIFICATION_TYPES.TASK_DUE_SOON]: 'Task Due Soon',
  [NOTIFICATION_TYPES.TASK_OVERDUE]: 'Task Overdue',
  [NOTIFICATION_TYPES.SPRINT_STARTED]: 'Sprint Started',
  [NOTIFICATION_TYPES.SPRINT_ENDING_SOON]: 'Sprint Ending Soon',
  [NOTIFICATION_TYPES.SPRINT_COMPLETED]: 'Sprint Completed',
  [NOTIFICATION_TYPES.LEAVE_APPROVED]: 'Leave Approved',
  [NOTIFICATION_TYPES.LEAVE_REJECTED]: 'Leave Rejected',
  [NOTIFICATION_TYPES.LEAVE_REQUESTED]: 'Leave Requests',
  [NOTIFICATION_TYPES.LEAVE_CANCELLED]: 'Leave Cancelled',
  [NOTIFICATION_TYPES.ATTENDANCE_LATE]: 'Late Check-in',
  [NOTIFICATION_TYPES.ATTENDANCE_MISSED]: 'Missed Attendance',
  [NOTIFICATION_TYPES.COMMENT_MENTION]: 'Mentions in Comments',
  [NOTIFICATION_TYPES.COMMENT_REPLY]: 'Replies to Comments',
  [NOTIFICATION_TYPES.TEAM_MEMBER_ADDED]: 'Team Member Added',
  [NOTIFICATION_TYPES.TEAM_MEMBER_REMOVED]: 'Team Member Removed',
};

const notificationDescriptions: Record<string, string> = {
  [NOTIFICATION_TYPES.TASK_ASSIGNED]: 'When you are assigned to a task',
  [NOTIFICATION_TYPES.TASK_STATUS_CHANGED]: 'When a task status is updated',
  [NOTIFICATION_TYPES.TASK_PRIORITY_CHANGED]: 'When task priority changes',
  [NOTIFICATION_TYPES.TASK_COMPLETED]: 'When a task is completed',
  [NOTIFICATION_TYPES.TASK_DUE_SOON]: 'When tasks are approaching their due date',
  [NOTIFICATION_TYPES.TASK_OVERDUE]: 'When tasks become overdue',
  [NOTIFICATION_TYPES.SPRINT_STARTED]: 'When a sprint begins',
  [NOTIFICATION_TYPES.SPRINT_ENDING_SOON]: 'When a sprint is about to end',
  [NOTIFICATION_TYPES.SPRINT_COMPLETED]: 'When a sprint is completed',
  [NOTIFICATION_TYPES.LEAVE_APPROVED]: 'When your leave is approved',
  [NOTIFICATION_TYPES.LEAVE_REJECTED]: 'When your leave is rejected',
  [NOTIFICATION_TYPES.LEAVE_REQUESTED]: 'When someone requests leave',
  [NOTIFICATION_TYPES.LEAVE_CANCELLED]: 'When leave is cancelled',
  [NOTIFICATION_TYPES.ATTENDANCE_LATE]: 'When you check in late',
  [NOTIFICATION_TYPES.ATTENDANCE_MISSED]: 'When attendance is missed',
  [NOTIFICATION_TYPES.COMMENT_MENTION]: 'When someone mentions you in a comment',
  [NOTIFICATION_TYPES.COMMENT_REPLY]: 'When someone replies to your comment',
  [NOTIFICATION_TYPES.TEAM_MEMBER_ADDED]: 'When a new team member joins',
  [NOTIFICATION_TYPES.TEAM_MEMBER_REMOVED]: 'When a team member leaves',
};

export default function NotificationPreferences() {
  const [preferences, setPreferences] =
    React.useState<Record<string, NotificationPreference>>(getDefaultPreferences());
  const [isSaving, setIsSaving] = React.useState(false);

  // Load preferences from localStorage on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('notification-preferences');
      if (saved) {
        const parsed = JSON.parse(saved);
        setPreferences({ ...getDefaultPreferences(), ...parsed });
      }
    } catch (error) {
      logger.error('Failed to load notification preferences', { error });
    }
  }, []);

  const handleToggle = (type: string, channel: 'inApp' | 'email') => {
    setPreferences((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        [channel]: !prev[type][channel],
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      // Save to localStorage
      localStorage.setItem('notification-preferences', JSON.stringify(preferences));
      toast.success('Notification preferences saved successfully');
    } catch (error) {
      logger.error('Failed to save preferences', { error });
      toast.error('Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const categorizedTypes = groupByCategory();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Notification Preferences</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose how you want to be notified about different events
        </p>
      </div>

      {Object.entries(categorizedTypes).map(([category, types]) => {
        if (types.length === 0) return null;

        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="text-base">
                {categoryLabels[category as NotificationCategory]}
              </CardTitle>
              <CardDescription>
                {categoryDescriptions[category as NotificationCategory]}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_80px_80px] gap-4 items-center text-sm font-medium pb-2 border-b">
                <div>Notification Type</div>
                <div className="flex items-center gap-1 justify-center">
                  <Bell className="h-3.5 w-3.5" />
                  <span>In-App</span>
                </div>
                <div className="flex items-center gap-1 justify-center">
                  <Mail className="h-3.5 w-3.5" />
                  <span>Email</span>
                </div>
              </div>

              {types.map((type) => {
                const pref = preferences[type];
                if (!pref) return null;

                return (
                  <div key={type} className="grid grid-cols-[1fr_80px_80px] gap-4 items-center">
                    <div className="space-y-0.5">
                      <Label className="font-normal">{notificationLabels[type] || type}</Label>
                      <p className="text-xs text-muted-foreground">
                        {notificationDescriptions[type] || ''}
                      </p>
                    </div>

                    <div className="flex justify-center">
                      <Switch
                        checked={pref.inApp}
                        onCheckedChange={() => handleToggle(type, 'inApp')}
                      />
                    </div>

                    <div className="flex justify-center">
                      <Switch
                        checked={pref.email}
                        onCheckedChange={() => handleToggle(type, 'email')}
                        disabled={!NOTIFICATION_TEMPLATES[type].requiresEmail}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setPreferences(getDefaultPreferences())}>
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}
