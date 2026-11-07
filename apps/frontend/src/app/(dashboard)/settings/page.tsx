'use client';

import { PageHeader } from '@/components/layout/page-header';

import * as React from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTheme } from 'next-themes';
import { DeleteWorkspaceDialog } from '@/components/workspace/delete-workspace-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTabParam } from '@/hooks/use-tab-param';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IntegrationsPanel } from '@/components/settings/integrations-panel';
import { RolesPanel } from '@/components/settings/roles-panel';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Settings as SettingsIcon,
  // Globe,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import NotificationPreferences from '@/components/settings/notification-preferences';
import { useHasPermission } from '@/hooks/use-permissions';
import {
  getServerTimeZone,
  todayDateOnly,
  workingSaturdaysOn,
  workingWeekOf,
} from '@/lib/utils/working-days';
import { Checkbox } from '@/components/ui/checkbox';
import { Permission } from '@/lib/permissions';
import { authClient } from '@/lib/api/client';
import { useUpdateWorkspace } from '@/hooks/use-workspace';
import { EmptyState } from '@/components/ui/empty-state';
import { NoAccess } from '@/components/ui/no-access';
import { TransferOwnershipCard } from '@/components/workspace/transfer-ownership-card';
import type { Workspace } from '@/types';

// Every tab the page renders. 'integrations' was missing, so a link to
// /settings?tab=integrations opened Profile and a refresh on that tab left it.
const SETTINGS_TABS = [
  'profile',
  'workspace',
  'roles',
  'notifications',
  'security',
  'appearance',
  'integrations',
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The tab lives in the URL (useTabParam -> useSearchParams), which opts the
 *  subtree into client rendering — so it needs its own Suspense boundary rather
 *  than suspending the whole route. */
/**
 * Every timezone this runtime can actually resolve.
 *
 * `Intl.supportedValuesOf` rather than a bundled list: the runtime already knows exactly
 * which zones it can resolve, and a hand-maintained list drifts from that — offering a
 * value the server would then refuse. Older runtimes without it get a short list of common
 * zones, and the caller adds whatever the workspace already has set so an existing value
 * is never missing from its own picker.
 */
const FALLBACK_TIMEZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo',
  'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Los_Angeles', 'Australia/Sydney', 'UTC',
];

function supportedTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.('timeZone');
    if (supported?.length) return supported;
  } catch {
    // fall through
  }
  return FALLBACK_TIMEZONES;
}

const TIMEZONE_OPTIONS = supportedTimezones();

/**
 * What "same as the server" actually resolves to, so the default is not a blank.
 *
 * The SERVER's zone, as `/auth/me` reported it. This used to print the browser's
 * own zone under that label — right only for somebody sitting in the server's
 * region, and wrong in exactly the case the setting exists for.
 */
const serverTimezoneLabel = (): string => getServerTimeZone() ?? 'the server’s timezone';

// The hours a workspace runs on until it declares its own, and the widest grace
// period the API accepts. Mirrors @strata/config's workspace-settings.
const DEFAULT_WORKDAY_START = '08:30';
const DEFAULT_LATE_GRACE_MINUTES = 15;
const MAX_LATE_GRACE_MINUTES = 240;

/** Weeks of the month a Saturday can fall in, for the working-week control. */
const SATURDAY_WEEKS = [
  { week: 1, label: '1st' },
  { week: 2, label: '2nd' },
  { week: 3, label: '3rd' },
  { week: 4, label: '4th' },
  { week: 5, label: '5th' },
] as const;

/** The Workspace tab's fields, as strings, the way the form holds them. */
interface WorkspaceForm {
  name: string;
  description: string;
  timezone: string;
  workdayStart: string;
  lateGrace: string;
  /** The Saturdays worked from today, as '1,3' — weeks of the month, sorted. */
  saturdays: string;
}

const weeksText = (weeks: readonly number[]): string =>
  [...weeks].sort((a, b) => a - b).join(',');
const weeksOf = (text: string): number[] => (text ? text.split(',').map(Number) : []);

function workspaceFormOf(ws: Workspace): WorkspaceForm {
  const s = ws.settings;
  return {
    name: ws.name,
    description: ws.description ?? '',
    timezone: typeof s?.timezone === 'string' ? s.timezone : '',
    workdayStart: typeof s?.workdayStart === 'string' ? s.workdayStart : DEFAULT_WORKDAY_START,
    lateGrace: String(
      typeof s?.lateGraceMinutes === 'number' ? s.lateGraceMinutes : DEFAULT_LATE_GRACE_MINUTES
    ),
    // The rule in force today: the history's latest word, or the default.
    saturdays: weeksText(workingSaturdaysOn(todayDateOnly(), workingWeekOf(s))),
  };
}

const sameForm = (a: WorkspaceForm, b: WorkspaceForm): boolean =>
  a.name === b.name &&
  a.description === b.description &&
  a.timezone === b.timezone &&
  a.workdayStart === b.workdayStart &&
  a.lateGrace === b.lateGrace &&
  a.saturdays === b.saturdays;

export default function SettingsPage() {
  return (
    <React.Suspense fallback={<PageLoader message="Loading settings..." />}>
      <SettingsPageContent />
    </React.Suspense>
  );
}

function SettingsPageContent() {
  const { user, refreshUser } = useAuth();
  const { currentWorkspace, isLoading: workspacesLoading } = useCurrentWorkspace();
  const { theme, setTheme, systemTheme } = useTheme();
  const updateWorkspace = useUpdateWorkspace();

  // Deep links such as /settings?tab=workspace (the Workspaces page uses one) must
  // land on the tab they name; anything else falls back to Profile.
  //
  // This used to be local state seeded from the URL and an effect syncing one way
  // only: clicking a tab never wrote it back, so a refresh or Back jumped to
  // whatever the address still said. The hook owns both directions, which also
  // retires the mirror-state-and-sync dance.
  const [tab, setTab] = useTabParam<SettingsTab>(SETTINGS_TABS, 'profile');

  const [mounted, setMounted] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [compactMode, setCompactMode] = React.useState(false);
  const [showAnimations, setShowAnimations] = React.useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  /**
   * Two different gates, matching the API exactly: the workspace settings form
   * needs `workspace:update`, which both MANAGER and ASSISTANT_MANAGER hold, so
   * it opens for either. Deleting the workspace needs `workspace:delete`, which
   * only MANAGER holds. Gating the whole tab on isManager locked assistant
   * managers out of settings the server would have let them change.
   *
   * Asked as PERMISSIONS, not role names: a custom role holding either key is
   * authorised by the API and was shown "Access Denied" here, and the Workspaces
   * page answered the delete question a third way (by ownership).
   */
  const canManageWorkspace = useHasPermission(Permission.MANAGE_WORKSPACE_SETTINGS);
  // The server asks for workspace:delete AND the owner (or a platform admin):
  // the owner cannot be removed by any manager, so neither can their workspace.
  const holdsDelete = useHasPermission(Permission.DELETE_WORKSPACE);
  const canDeleteWorkspace =
    holdsDelete && (user?.isAdmin === true || currentWorkspace?.ownerId === user?.id);

  // Profile form state
  const [profileName, setProfileName] = React.useState('');
  const [profilePhone, setProfilePhone] = React.useState(user?.phone ?? '');
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (user) setProfileName(user.name || '');
  }, [user]);


  // Workspace form state. Controlled, not `defaultValue` refs: the switcher can
  // change `currentWorkspace` underneath this page, and React ignores
  // defaultValue on re-render — the form would then save workspace A's name
  // onto workspace B.
  const [wsName, setWsName] = React.useState('');
  const [wsDescription, setWsDescription] = React.useState('');
  // '' means "not declared" — the API and the date helpers then use the server's zone.
  const [wsTimezone, setWsTimezone] = React.useState('');
  // The hours in force, shown as they are: a workspace that has declared none
  // runs on the defaults, so the defaults are what the fields say.
  const [wsWorkdayStart, setWsWorkdayStart] = React.useState(DEFAULT_WORKDAY_START);
  const [wsLateGrace, setWsLateGrace] = React.useState(String(DEFAULT_LATE_GRACE_MINUTES));
  // The Saturdays worked, '1,3' — the default until the workspace says.
  const [wsSaturdays, setWsSaturdays] = React.useState('1,3');
  /**
   * Fill the form from the workspace — when it is a different workspace, or
   * when nothing typed here would be lost.
   *
   * It refilled on every new `currentWorkspace` object, and that object is
   * rebuilt whenever the workspace list refetches: somebody joining or being
   * removed changes its `memberIds`, so a manager halfway through renaming the
   * workspace had the field reset under them. What the server says only wins
   * now if it actually changed, and the form holds no edit of its own — still
   * reading what was last filled in, or already saying what the server says
   * (as it does once a save comes back).
   */
  const seeded = React.useRef<{ id: string; form: WorkspaceForm } | null>(null);
  React.useEffect(() => {
    if (!currentWorkspace) return;
    const server = workspaceFormOf(currentWorkspace);
    const last = seeded.current;
    if (last && last.id === currentWorkspace.id) {
      // Nothing new from the server — the list refetched for another reason.
      if (sameForm(last.form, server)) return;
      const typed: WorkspaceForm = {
        name: wsName,
        description: wsDescription,
        timezone: wsTimezone,
        workdayStart: wsWorkdayStart,
        lateGrace: wsLateGrace,
        saturdays: wsSaturdays,
      };
      // Unsaved edits: they stay, and are what a save will send.
      if (!sameForm(typed, last.form) && !sameForm(typed, server)) return;
    }
    seeded.current = { id: currentWorkspace.id, form: server };
    setWsName(server.name);
    setWsDescription(server.description);
    setWsTimezone(server.timezone);
    setWsWorkdayStart(server.workdayStart);
    setWsLateGrace(server.lateGrace);
    setWsSaturdays(server.saturdays);
  }, [currentWorkspace, wsName, wsDescription, wsTimezone, wsWorkdayStart, wsLateGrace, wsSaturdays]);

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);

    // Load display preferences from localStorage
    const compactModeStored = localStorage.getItem('compact-mode') === 'true';
    const noAnimations = localStorage.getItem('no-animations') === 'true';

    setCompactMode(compactModeStored);
    setShowAnimations(!noAnimations);

    // Apply stored preferences
    if (compactModeStored) {
      document.documentElement.classList.add('compact-mode');
    }
    if (noAnimations) {
      document.documentElement.classList.add('no-animations');
    }
  }, []);

  // Get actual current theme (resolving system preference)
  const currentTheme = theme === 'system' ? systemTheme : theme;

  const handleProfileUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    if (!profileName.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setIsUpdating(true);
    try {
      await authClient.updateName(profileName.trim());
      if (profilePhone.trim() !== (user.phone ?? '')) {
        await authClient.updatePhone(profilePhone.trim());
      }
      await refreshUser();
      toast.success('Profile saved');
    } catch (error: unknown) {
      toast.error('Failed to update profile', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        await authClient.updateAvatar(dataUrl);
        await refreshUser();
        toast.success('Avatar updated successfully');
      } catch (error: unknown) {
        toast.error('Failed to update avatar', {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleWorkspaceUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentWorkspace) return;
    if (!wsName.trim()) {
      toast.error('Workspace name cannot be empty');
      return;
    }
    const lateGrace = Number(wsLateGrace);
    if (
      wsLateGrace.trim() === '' ||
      !Number.isInteger(lateGrace) ||
      lateGrace < 0 ||
      lateGrace > MAX_LATE_GRACE_MINUTES
    ) {
      toast.error(
        `The grace period has to be a whole number of minutes between 0 and ${MAX_LATE_GRACE_MINUTES}`
      );
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(wsWorkdayStart)) {
      toast.error('Enter the time the working day starts');
      return;
    }
    setIsUpdating(true);
    try {
      /**
       * Exactly what this form declares, and nothing carried over.
       *
       * The stored object used to be spread in first, which is how three
       * switches that once sat here — "Allow member invites", "Public
       * workspace", "Require approval for tasks" — went on being re-saved long
       * after anything read them, and how choosing "Same as the server" re-saved
       * the old timezone so the declaration could never be withdrawn. The API
       * keeps only these keys now, so there is nothing else to preserve.
       */
      await updateWorkspace.mutateAsync({
        workspaceId: currentWorkspace.id,
        name: wsName.trim(),
        description: wsDescription,
        settings: {
          // Omitted entirely when not declared, rather than stored as '': the API and the
          // date helpers both test for a non-empty string, and an empty one would read as
          // a declaration of nothing.
          ...(wsTimezone ? { timezone: wsTimezone } : {}),
          workdayStart: wsWorkdayStart,
          lateGraceMinutes: lateGrace,
          // The rule from today on. The API keeps the history, so days already
          // worked keep the rule they were worked under, and an unchanged rule
          // adds nothing to it.
          workingSaturdays: weeksOf(wsSaturdays),
        },
      });
      // success toast is fired by the mutation
    } catch {
      // error toast handled inside mutation
    } finally {
      setIsUpdating(false);
    }
  };

  if (workspacesLoading) {
    return <PageLoader message="Loading settings..." />;
  }

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={SettingsIcon}
        title="No workspace found"
        description="Create a workspace to access settings."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Manage your account and workspace preferences"
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and profile picture
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileUpdate} className="space-y-6">
                <div className="flex items-center gap-6">
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={user?.avatar} alt={user?.name} />
                    <AvatarFallback className="text-2xl">
                      {user?.name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="space-y-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/gif,image/png"
                      className="hidden"
                      onChange={handleAvatarChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      Change Avatar
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      JPG, GIF or PNG. Max size of 2MB.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </div>

                  {/* The Team page shows each member's phone; nothing let anybody
                      set their own. */}
                  <div className="grid gap-2">
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown to your colleagues on the Team page.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" defaultValue={user?.email} disabled />
                    <p className="text-xs text-muted-foreground">
                      Your email is how you sign in, so it is changed by a platform administrator, not here.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isUpdating}>
                    {isUpdating ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workspace Tab - Manager Only */}
        <TabsContent value="workspace" className="space-y-4">
          {!canManageWorkspace ? (
            <NoAccess what="change this workspace's settings" />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Workspace Settings</CardTitle>
                  <CardDescription>Manage workspace details and configuration</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleWorkspaceUpdate} className="space-y-6">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="workspace-name">Workspace Name</Label>
                        <Input
                          id="workspace-name"
                          value={wsName}
                          onChange={(e) => setWsName(e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="workspace-desc">Description</Label>
                        <Textarea
                          id="workspace-desc"
                          value={wsDescription}
                          onChange={(e) => setWsDescription(e.target.value)}
                          rows={3}
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <h3 className="text-lg font-medium">Workspace Preferences</h3>

                      <div className="space-y-2">
                        <Label htmlFor="ws-timezone">Working-day timezone</Label>
                        <p className="text-sm text-muted-foreground">
                          Attendance is recorded against a calendar day. This decides whose
                          day that is — set it to the office&apos;s timezone so a member
                          working elsewhere still files against the same day as everyone
                          here.
                        </p>
                        <select
                          id="ws-timezone"
                          value={wsTimezone}
                          onChange={(e) => setWsTimezone(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <option value="">
                            Same as the server ({serverTimezoneLabel()})
                          </option>
                          {TIMEZONE_OPTIONS.map((zone) => (
                            <option key={zone} value={zone}>
                              {zone}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* The office's hours. Lateness was measured against 08:30
                          plus fifteen minutes for every workspace, with no way
                          to say otherwise. */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="ws-workday-start">Working day starts at</Label>
                          <Input
                            id="ws-workday-start"
                            type="time"
                            value={wsWorkdayStart}
                            onChange={(e) => setWsWorkdayStart(e.target.value)}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ws-late-grace">Grace period (minutes)</Label>
                          <Input
                            id="ws-late-grace"
                            type="number"
                            min={0}
                            max={MAX_LATE_GRACE_MINUTES}
                            step={1}
                            value={wsLateGrace}
                            onChange={(e) => setWsLateGrace(e.target.value)}
                            required
                          />
                        </div>
                        <p className="text-sm text-muted-foreground sm:col-span-2">
                          A check-in later than the start time plus the grace period is
                          recorded as late, measured in the timezone above. Changing these
                          applies from the next check-in. Days already recorded keep their
                          figures unless a manager corrects one, which measures it against
                          the hours set here.
                        </p>
                      </div>
                    </div>

                    <fieldset className="space-y-3">
                      <legend className="text-sm font-medium">Saturdays worked</legend>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {SATURDAY_WEEKS.map(({ week, label }) => {
                          const checked = weeksOf(wsSaturdays).includes(week);
                          const id = `ws-saturday-${week}`;
                          return (
                            <div key={week} className="flex items-center gap-2">
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={(on) => {
                                  const weeks = weeksOf(wsSaturdays).filter((w) => w !== week);
                                  setWsSaturdays(weeksText(on === true ? [...weeks, week] : weeks));
                                }}
                              />
                              <Label htmlFor={id} className="font-normal">
                                {label} Saturday
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {wsSaturdays
                          ? 'Sundays are always off.'
                          : 'No Saturday is worked. Sundays are always off.'}{' '}
                        A change applies from today: leave and attendance from today on are
                        counted again — a leave across a Saturday that becomes a working day
                        costs a day more, one across a Saturday that stops being one a day
                        less — and days before today keep the rule they had.
                      </p>
                    </fieldset>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={isUpdating}>
                        {isUpdating ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {/* Adding people is done on the Team page, where every way in sits
                  together: one person, a CSV, an invite code. A third copy of
                  the invite-code panel lived here. */}
              <Card>
                <CardHeader>
                  <CardTitle>Adding people</CardTitle>
                  <CardDescription>
                    Add a person, import several from a CSV, or make an invite code — all on the
                    Team page.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" asChild>
                    <Link href="/team?tab=add-members">Go to Add Members</Link>
                  </Button>
                </CardContent>
              </Card>

              {(user?.isAdmin === true || currentWorkspace.ownerId === user?.id) && (
                <TransferOwnershipCard
                  workspaceId={currentWorkspace.id}
                  workspaceName={currentWorkspace.name}
                  ownerId={currentWorkspace.ownerId}
                />
              )}

              {canDeleteWorkspace && (
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader>
                  <CardTitle className="text-destructive-text">Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions for this workspace</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Delete Workspace</p>
                      <p className="text-sm text-muted-foreground">
                        Permanently delete this workspace and all its data
                      </p>
                    </div>
                    <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <NotificationPreferences />
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your account security and privacy</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* A password is changed on its own page — the one the Profile
                  page leads to, and the one a temporary password forces. This
                  tab carried a second copy of that form, with its own
                  validation and its own wording for the same mistakes; and
                  under it "Two-Factor Authentication — Coming Soon", for a
                  feature this application does not have. */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-lg font-medium">Password</h3>
                  <p className="text-sm text-muted-foreground">
                    Changing it signs you out everywhere else.
                  </p>
                </div>
                <Button variant="outline" asChild>
                  <Link href="/change-password">Change Password</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Tab */}
        {/* What each role allows, and the workspace's own roles. Open to every
            member — it is how anybody learns what their role can do — and
            editable by whoever holds role:manage. */}
        <TabsContent value="roles" className="space-y-4">
          {currentWorkspace ? (
            <RolesPanel workspaceId={currentWorkspace.id} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Select a workspace to see its roles.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* The integrations API had no client at all: three providers with full
            CRUD and encrypted token storage, unreachable from the app. */}
        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsPanel />
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Appearance Settings</CardTitle>
              <CardDescription>Customize the look and feel of your workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Theme</h3>
                <p className="text-sm text-muted-foreground">
                  Select the theme for the application
                  {mounted && theme === 'system' && ` (currently using ${currentTheme} mode)`}
                </p>

                {mounted ? (
                  <RadioGroup
                    value={theme}
                    onValueChange={(value) => setTheme(value)}
                    className="grid gap-4"
                  >
                    <div
                      className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'light' ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem value="light" id="light" />
                        <Label htmlFor="light" className="cursor-pointer flex items-center gap-3">
                          <div className="h-10 w-10 rounded bg-white dark:bg-gray-800 border-2 shadow-sm" />
                          <div>
                            <p className="font-medium">Light</p>
                            <p className="text-sm text-muted-foreground">Light color scheme</p>
                          </div>
                        </Label>
                      </div>
                    </div>

                    <div
                      className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'dark' ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem value="dark" id="dark" />
                        <Label htmlFor="dark" className="cursor-pointer flex items-center gap-3">
                          <div className="h-10 w-10 rounded bg-gray-900 border-2 shadow-sm" />
                          <div>
                            <p className="font-medium">Dark</p>
                            <p className="text-sm text-muted-foreground">Dark color scheme</p>
                          </div>
                        </Label>
                      </div>
                    </div>

                    <div
                      className={`flex items-center justify-between p-4 rounded-lg border ${theme === 'system' ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem value="system" id="system" />
                        <Label htmlFor="system" className="cursor-pointer flex items-center gap-3">
                          <div className="h-10 w-10 rounded bg-linear-to-br from-white via-gray-500 to-gray-900 border-2 shadow-sm" />
                          <div>
                            <p className="font-medium">System</p>
                            <p className="text-sm text-muted-foreground">
                              Follow system preference
                            </p>
                          </div>
                        </Label>
                      </div>
                    </div>
                  </RadioGroup>
                ) : (
                  <div className="text-sm text-muted-foreground">Loading theme settings...</div>
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium">Display</h3>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="compact-mode">Compact mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Use smaller spacing between elements
                    </p>
                  </div>
                  <Switch
                    id="compact-mode"
                    checked={compactMode}
                    onCheckedChange={(checked) => {
                      setCompactMode(checked);
                      if (checked) {
                        document.documentElement.classList.add('compact-mode');
                        localStorage.setItem('compact-mode', 'true');
                        toast.success('Compact mode enabled');
                      } else {
                        document.documentElement.classList.remove('compact-mode');
                        localStorage.removeItem('compact-mode');
                        toast.success('Compact mode disabled');
                      }
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="show-animations">Show animations</Label>
                    <p className="text-sm text-muted-foreground">Enable interface animations</p>
                  </div>
                  <Switch
                    id="show-animations"
                    checked={showAnimations}
                    onCheckedChange={(checked) => {
                      setShowAnimations(checked);
                      if (checked) {
                        document.documentElement.classList.remove('no-animations');
                        localStorage.removeItem('no-animations');
                        toast.success('Animations enabled');
                      } else {
                        document.documentElement.classList.add('no-animations');
                        localStorage.setItem('no-animations', 'true');
                        toast.success('Animations disabled');
                      }
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Workspace Dialog */}
      <DeleteWorkspaceDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} />
    </div>
  );
}
