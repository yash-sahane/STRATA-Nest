'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from 'sonner';
import { Bell, Mail } from 'lucide-react';
import { logger } from '@/lib/logger';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '@/hooks/use-notification';
import { useAuth } from '@/components/providers/auth-provider';
import type { NotificationType } from '@/types';

interface NotificationPreference {
  type: string;
  inApp: boolean;
  email: boolean;
}

interface NotificationKind {
  /** The key the server files the preference under: the notification's own type. */
  type: NotificationType;
  label: string;
  description: string;
  /** Whether a mail is ever sent for this type. Where none is, there is no
   *  email switch to offer. */
  email: boolean;
}

/**
 * Every notification the server sends, and nothing else.
 *
 * This page used to be generated from the client's old message templates, from
 * the days when the browser wrote notifications itself. Half the rows were for
 * things nothing produces any more ("Task Added to Sprint", "Mentions in
 * Comments", "Missed Attendance", "Workspace Invitations") — switches wired to
 * nothing — while the notifications people actually receive (a join request, a
 * role change, a task sent for review, a deadline reminder) had no row at all
 * and so could not be turned off.
 *
 * Mirrors the producers in apps/api/src/modules/notifications: the work
 * subscriber, the membership/HR subscriber and the deadline reminders. Adding a
 * notification there means adding its row here.
 */
const NOTIFICATION_GROUPS: Array<{ title: string; description: string; kinds: NotificationKind[] }> =
  [
    {
      title: 'Tasks',
      description: 'Work assigned to you, and what happens to it.',
      kinds: [
        {
          type: 'TASK_ASSIGNED',
          label: 'Task assigned to you',
          description: 'When somebody assigns you a task',
          email: true,
        },
        {
          type: 'TASK_STATUS_CHANGED',
          label: 'Task status changed',
          description: 'When a task you are on moves to another status',
          email: false,
        },
        {
          type: 'TASK_PRIORITY_CHANGED',
          label: 'Task priority changed',
          description: 'When the priority of a task you are on changes',
          email: false,
        },
        {
          type: 'TASK_UNASSIGNED',
          label: 'Taken off a task',
          description: 'When somebody removes you from a task you were assigned to',
          email: false,
        },
        {
          type: 'TASK_COMMENT_ADDED',
          label: 'Comment on a task',
          description: 'When somebody comments on a task you are on, or one you raised',
          email: false,
        },
        {
          type: 'TASK_COMMENT_REMOVED',
          label: 'Your comment was removed',
          description: 'When somebody who runs the work takes down a comment of yours',
          email: false,
        },
        {
          type: 'TASK_REVIEW_REQUESTED',
          label: 'Task ready for review',
          description: 'When a task is moved to Review and you are one of the people who can close it',
          email: true,
        },
        {
          type: 'TASK_REVIEWED_DONE',
          label: 'Task completed',
          description: 'When a task you worked on is reviewed and marked done',
          email: true,
        },
        {
          type: 'TASK_DEADLINE_REMINDER',
          label: 'Deadline approaching',
          description: 'A week, three days and one day before a task of yours is due, and on the day',
          email: true,
        },
        {
          type: 'TASK_OVERDUE',
          label: 'Task overdue',
          description: 'When a task of yours passes its due date unfinished',
          email: true,
        },
        {
          type: 'TASK_DELETED',
          label: 'Task deleted',
          description: 'When somebody deletes a task that was assigned to you',
          email: false,
        },
      ],
    },
    {
      title: 'Requirements and planning',
      description: 'New work entering a project you are part of.',
      kinds: [
        {
          type: 'REQUIREMENT_CREATED',
          label: 'New client requirement',
          description: 'When a client requirement is added to a project',
          email: false,
        },
        {
          type: 'EPIC_CREATED',
          label: 'New epic',
          description: 'When an epic is created',
          email: false,
        },
        {
          type: 'FR_ASSIGNED',
          label: 'Functional requirement assigned to you',
          description: 'When you are made responsible for a functional requirement',
          email: true,
        },
        {
          type: 'FR_UNASSIGNED',
          label: 'Taken off a functional requirement',
          description: 'When somebody takes you off a functional requirement, and so off its open tasks',
          email: false,
        },
      ],
    },
    {
      title: 'Sprints',
      description: 'The sprints your tasks are in.',
      kinds: [
        {
          type: 'SPRINT_STARTED',
          label: 'Sprint started',
          description: 'When a sprint you have tasks in begins',
          email: true,
        },
        {
          type: 'SPRINT_READY_TO_CLOSE',
          label: 'Sprint ready to close',
          description: 'When the last task of the active sprint is finished',
          email: true,
        },
        {
          type: 'SPRINT_COMPLETED',
          label: 'Sprint completed',
          description: 'When a sprint you had tasks in is closed',
          email: true,
        },
      ],
    },
    {
      title: 'Leave, attendance and time',
      description: 'Your own requests, and the ones waiting on you.',
      kinds: [
        {
          type: 'LEAVE_REQUESTED',
          label: 'Leave request to review',
          description: 'When somebody asks for leave and you are one of the approvers',
          email: true,
        },
        {
          type: 'LEAVE_APPROVED',
          label: 'Leave approved',
          description: 'When your leave request is approved',
          email: true,
        },
        {
          type: 'LEAVE_REJECTED',
          label: 'Leave rejected',
          description: 'When your leave request is turned down',
          email: true,
        },
        {
          type: 'LEAVE_CANCELLED',
          label: 'Leave cancelled',
          description:
            'When somebody cancels leave you approve — or an approver cancels a request of yours',
          email: true,
        },
        {
          type: 'LEAVE_BALANCE_ADJUSTED',
          label: 'Leave balance changed',
          description: 'When an approver changes how many days of leave you have',
          email: false,
        },
        {
          type: 'ATTENDANCE_CORRECTED',
          label: 'Attendance corrected',
          description: 'When a manager files, corrects or deletes a day of your attendance',
          email: false,
        },
        {
          type: 'TIME_ENTRY_SUBMITTED',
          label: 'Time waiting for your approval',
          description: 'When somebody logs time and you are one of the people who approve it — once, until you look',
          email: false,
        },
        {
          type: 'TIME_ENTRY_APPROVED',
          label: 'Time entry approved',
          description: 'When time you logged is approved',
          email: false,
        },
        {
          type: 'TIME_ENTRY_REJECTED',
          label: 'Time entry rejected',
          description: 'When time you logged is sent back',
          email: false,
        },
      ],
    },
    {
      title: 'Workspace',
      // "Added to the workspace" and the join-request answers are not listed:
      // they are filed under a workspace you have not joined yet, where no
      // setting of yours can apply. They always arrive.
      description: 'Membership of this workspace.',
      kinds: [
        {
          type: 'WORKSPACE_ROLE_CHANGED',
          label: 'Your role changed',
          description: 'When your role in this workspace is changed',
          email: false,
        },
        {
          type: 'WORKSPACE_OWNERSHIP_TRANSFERRED',
          label: 'A workspace handed to you',
          description: 'When the owner of this workspace makes you its owner',
          email: false,
        },
        {
          type: 'JOIN_REQUEST_RECEIVED',
          label: 'Request to join',
          description: 'When somebody asks to join and you are one of the people who can let them in',
          email: false,
        },
        {
          type: 'WORKSPACE_ACCESS_CHANGED',
          label: 'Your access switched off or on',
          description: 'When a manager switches your access to this workspace off, or back on',
          email: true,
        },
        {
          type: 'WORKSPACE_MEMBER_REMOVED',
          label: 'Removed from the workspace',
          description: 'When a manager removes you from this workspace',
          email: true,
        },
      ],
    },
  ];

const ALL_KINDS = NOTIFICATION_GROUPS.flatMap((group) => group.kinds);

/** Everything on, on every channel that exists — which is also what the server
 *  assumes for a type with no stored row. */
const getDefaultPreferences = (): Record<string, NotificationPreference> =>
  Object.fromEntries(
    ALL_KINDS.map((kind) => [kind.type, { type: kind.type, inApp: true, email: kind.email }])
  );

export default function NotificationPreferences() {
  // Email switches mean nothing where no mail is delivered.
  const mailDelivers = useAuth().user?.mailDelivers !== false;
  const { currentWorkspaceId } = useCurrentWorkspace();
  const {
    data: saved,
    isLoading,
    isError,
    refetch,
  } = useNotificationPreferences(currentWorkspaceId ?? undefined);
  const savePreferences = useSaveNotificationPreferences();

  const [preferences, setPreferences] =
    React.useState<Record<string, NotificationPreference>>(getDefaultPreferences());

  // Server rows are stored opt-out (only the toggles a user changed exist), so
  // they are layered over the defaults rather than replacing them. A stored row
  // for a type that is no longer sent has nothing to be layered onto.
  React.useEffect(() => {
    if (!saved) return;
    setPreferences(() => {
      const merged = getDefaultPreferences();
      saved.forEach((row) => {
        const type = row.type.toUpperCase();
        const fallback = merged[type];
        if (!fallback) return;
        // The default's `email` is exactly "does this type have a mail at all",
        // so a stored `true` for a type with none is not carried forward.
        merged[type] = { type, inApp: row.inApp, email: fallback.email ? row.email : false };
      });
      return merged;
    });
  }, [saved]);

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
    if (!currentWorkspaceId) {
      toast.error('Select a workspace before saving notification preferences');
      return;
    }

    try {
      await savePreferences.mutateAsync({
        workspaceId: currentWorkspaceId,
        preferences: Object.values(preferences).map((pref) => ({
          type: pref.type,
          inApp: pref.inApp,
          email: pref.email,
        })),
      });
      toast.success('Notification preferences saved');
    } catch (error) {
      logger.error('Failed to save preferences', { error });
      toast.error(error instanceof Error ? error.message : 'Failed to save preferences');
    }
  };

  const isSaving = savePreferences.isPending;

  /**
   * A failed load must not be shown as "these are your settings".
   *
   * The state falls back to the defaults, so a GET that failed painted every
   * toggle at its default position — and Save then wrote that whole default set
   * over the choices the user had actually made, silently re-enabling
   * notifications they had turned off. Nothing is rendered until the real
   * preferences are in hand.
   */
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium">Notification Preferences</h3>
        </div>
        <ErrorState
          title="Couldn't load your notification preferences"
          description="Your saved choices are still there. Nothing is shown here until they load, so saving cannot overwrite them."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Notification Preferences</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which notifications you get in this workspace, and which of them also arrive by
          email. These are your own settings; nobody else is affected.
        </p>
        {!mailDelivers && (
          <p className="mt-2 text-sm text-muted-foreground">
            Email is not set up in this installation, so nothing is sent by email for now. Your
            email choices are kept for when it is.
          </p>
        )}
      </div>

      {NOTIFICATION_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle className="text-base">{group.title}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-[1fr_80px_80px] gap-4 items-center text-sm font-medium pb-2 border-b">
              <div>Notification</div>
              <div className="flex items-center gap-1 justify-center">
                <Bell className="h-3.5 w-3.5" />
                <span>In-App</span>
              </div>
              <div className="flex items-center gap-1 justify-center">
                <Mail className="h-3.5 w-3.5" />
                <span>Email</span>
              </div>
            </div>

            {group.kinds.map((kind) => {
              const pref = preferences[kind.type];
              if (!pref) return null;

              return (
                <div key={kind.type} className="grid grid-cols-[1fr_80px_80px] gap-4 items-center">
                  {/* The row's <Label> names the notification, not either
                      switch — and it is a sibling, so it labels neither.
                      Without an explicit name a screen reader announces two
                      identical "switch, on" controls per row with no way to
                      tell In-App from Email. */}
                  <div className="space-y-0.5">
                    <Label className="font-normal">{kind.label}</Label>
                    <p className="text-xs text-muted-foreground">{kind.description}</p>
                  </div>

                  <div className="flex justify-center">
                    <Switch
                      aria-label={`${kind.label}: in-app`}
                      checked={pref.inApp}
                      onCheckedChange={() => handleToggle(kind.type, 'inApp')}
                    />
                  </div>

                  <div className="flex justify-center">
                    {kind.email ? (
                      <Switch
                        aria-label={`${kind.label}: email`}
                        checked={pref.email}
                        disabled={!mailDelivers}
                        onCheckedChange={() => handleToggle(kind.type, 'email')}
                      />
                    ) : (
                      // No mail exists for this one. A dash, not a disabled
                      // switch stuck at "off": that reads as a setting somebody
                      // has locked, when there is nothing to set.
                      <span
                        className="text-muted-foreground"
                        title="This notification is not sent by email"
                      >
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">Not sent by email</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setPreferences(getDefaultPreferences())}
          disabled={isSaving}
        >
          Reset to Defaults
        </Button>
        <Button onClick={handleSave} disabled={isSaving || isLoading || !currentWorkspaceId}>
          {isSaving ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}
