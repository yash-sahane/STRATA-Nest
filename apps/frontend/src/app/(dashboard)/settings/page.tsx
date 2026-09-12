'use client';

import { PageHeader } from '@/components/layout/page-header';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useTheme } from 'next-themes';
import { DeleteWorkspaceDialog } from '@/components/workspace/delete-workspace-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PASSWORD_RULES, passwordFailures } from '@/lib/password-policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IntegrationsPanel } from '@/components/settings/integrations-panel';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Settings as SettingsIcon,
  // Globe,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import NotificationPreferences from '@/components/settings/notification-preferences';
import { useIsAdmin, useIsManager } from '@/hooks/use-permissions';
import { Shield } from 'lucide-react';
import { authClient } from '@/lib/api/client';
import { useUpdateWorkspace } from '@/hooks/use-workspace';
import { InviteCodePanel, InviteRoleSelect } from '@/components/workspace/invite-member-dialog';
import type { UserRole } from '@/types';

const SETTINGS_TABS = ['profile', 'workspace', 'notifications', 'security', 'appearance'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

/** `useSearchParams` opts the subtree into client rendering, so it needs its own
 *  Suspense boundary rather than suspending the whole route. */
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

  // Deep links such as /settings?tab=workspace (the Workspaces page uses one)
  // must land on the tab they name; anything else falls back to Profile.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = React.useState<SettingsTab>(() =>
    SETTINGS_TABS.includes(requestedTab as SettingsTab) ? (requestedTab as SettingsTab) : 'profile',
  );
  React.useEffect(() => {
    // The page stays mounted when the deep link is followed from another route.
    if (SETTINGS_TABS.includes(requestedTab as SettingsTab)) setTab(requestedTab as SettingsTab);
  }, [requestedTab]);

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
   */
  const canManageWorkspace = useIsAdmin();
  const isManager = useIsManager();

  // Profile form state
  const [profileName, setProfileName] = React.useState('');
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (user) setProfileName(user.name || '');
  }, [user]);

  // Security (password change) state
  const [pwForm, setPwForm] = React.useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = React.useState({ current: false, next: false, confirm: false });
  const [pwUpdating, setPwUpdating] = React.useState(false);

  // Workspace form state. Controlled, not `defaultValue` refs: the switcher can
  // change `currentWorkspace` underneath this page, and React ignores
  // defaultValue on re-render — the form would then save workspace A's name
  // onto workspace B.
  const [wsName, setWsName] = React.useState('');
  const [wsDescription, setWsDescription] = React.useState('');
  const [allowMemberInvites, setAllowMemberInvites] = React.useState(true);
  const [isPublicWorkspace, setIsPublicWorkspace] = React.useState(false);
  const [requireTaskApproval, setRequireTaskApproval] = React.useState(false);
  // The role an invite code hands out. MEMBER is the read-only floor, which is
  // the safe default for a code that may be pasted into a group chat.
  const [inviteCodeRole, setInviteCodeRole] = React.useState<UserRole>('MEMBER');
  React.useEffect(() => {
    if (!currentWorkspace) return;
    setWsName(currentWorkspace.name);
    setWsDescription(currentWorkspace.description ?? '');
    const s = currentWorkspace.settings;
    if (s) {
      if (typeof s.allowMemberInvites === 'boolean') setAllowMemberInvites(s.allowMemberInvites);
      if (typeof s.isPublic === 'boolean') setIsPublicWorkspace(s.isPublic);
      if (typeof s.requireTaskApproval === 'boolean') setRequireTaskApproval(s.requireTaskApproval);
    }
  }, [currentWorkspace]);

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
      await refreshUser();
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error('Failed to update profile', { description: error?.message });
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
      } catch (error: any) {
        toast.error('Failed to update avatar', { description: error?.message });
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
    setIsUpdating(true);
    try {
      await updateWorkspace.mutateAsync({
        workspaceId: currentWorkspace.id,
        name: wsName.trim(),
        description: wsDescription,
        settings: {
          ...(currentWorkspace.settings || {}),
          allowMemberInvites,
          isPublic: isPublicWorkspace,
          requireTaskApproval,
        },
      });
      // success toast is fired by the mutation
    } catch {
      // error toast handled inside mutation
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pwForm.next || !pwForm.current) {
      toast.error('Please fill in all password fields');
      return;
    }
    const pwFailures = passwordFailures(pwForm.next);
    if (pwFailures.length > 0) {
      toast.error(`New password must have: ${pwFailures.join(', ')}.`);
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (pwForm.next === pwForm.current) {
      toast.error('New password must be different from current password');
      return;
    }
    setPwUpdating(true);
    try {
      await authClient.updatePassword(pwForm.next, pwForm.current);
      toast.success('Password changed successfully');
      setPwForm({ current: '', next: '', confirm: '' });
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.includes('Invalid credentials') || msg.includes('invalid_credentials')) {
        toast.error('Current password is incorrect');
      } else {
        toast.error('Failed to change password', { description: msg || 'Please try again' });
      }
    } finally {
      setPwUpdating(false);
    }
  };

  if (workspacesLoading) {
    return <PageLoader message="Loading settings..." />;
  }

  if (!currentWorkspace) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <SettingsIcon className="h-16 w-16 text-muted-foreground/50 mx-auto" />
          <h2 className="text-2xl font-semibold">No Workspace Found</h2>
          <p className="text-muted-foreground">Create a workspace to access settings</p>
        </div>
      </div>
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

                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" defaultValue={user?.email} disabled />
                    <p className="text-xs text-muted-foreground">
                      Email cannot be changed here. Contact support if needed.
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
            <Card className="border-destructive/50">
              <CardHeader>
                <div className="flex items-center gap-2 text-destructive-text">
                  <Shield className="h-6 w-6" />
                  <CardTitle>Access Denied</CardTitle>
                </div>
                <CardDescription>
                  You don&apos;t have permission to access workspace settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Only workspace managers and administrators can manage workspace settings,
                  including renaming and deleting the workspace.
                </p>
                <p className="text-sm text-muted-foreground">
                  Please contact your workspace administrator if you need to make changes.
                </p>
              </CardContent>
            </Card>
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

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Allow member invites</Label>
                          <p className="text-sm text-muted-foreground">
                            Let team members invite others
                          </p>
                        </div>
                        <Switch
                          checked={allowMemberInvites}
                          onCheckedChange={setAllowMemberInvites}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Public workspace</Label>
                          <p className="text-sm text-muted-foreground">
                            Make workspace visible to public
                          </p>
                        </div>
                        <Switch
                          checked={isPublicWorkspace}
                          onCheckedChange={setIsPublicWorkspace}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Require approval for tasks</Label>
                          <p className="text-sm text-muted-foreground">
                            Tasks need approval before completion
                          </p>
                        </div>
                        <Switch
                          checked={requireTaskApproval}
                          onCheckedChange={setRequireTaskApproval}
                        />
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

              {/* This tab used to print `Workspace.inviteCode` under "Share this
                  code to invite team members". Nothing has ever redeemed that
                  column: POST /workspaces/accept-invitation looks the value up
                  in the InviteCode table, which the column is not mirrored
                  into, so every manager who followed that instruction sent out
                  a string the Join box answers with "Invalid invite code".
                  The field now shows a code minted through /invite_codes — the
                  same producer the Invite Member dialog uses, so the two
                  surfaces cannot disagree. */}
              <Card>
                <CardHeader>
                  <CardTitle>Invite Code</CardTitle>
                  <CardDescription>
                    Share a code with anyone who should join this workspace. They enter it after
                    signing in.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="invite-code-role">Role granted by the code</Label>
                    <InviteRoleSelect
                      id="invite-code-role"
                      value={inviteCodeRole}
                      onChange={setInviteCodeRole}
                    />
                  </div>
                  <InviteCodePanel
                    workspaceId={currentWorkspace.id}
                    role={inviteCodeRole}
                    idPrefix="workspace-invite-code"
                  />
                </CardContent>
              </Card>

              {isManager && (
              <Card className="border-red-200 dark:border-red-900">
                <CardHeader>
                  <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
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
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <h3 className="text-lg font-medium">Password</h3>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <div className="relative">
                      <Input
                        id="current-password"
                        type={showPw.current ? 'text' : 'password'}
                        value={pwForm.current}
                        onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPw({ ...showPw, current: !showPw.current })}
                      >
                        {showPw.current ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showPw.next ? 'text' : 'password'}
                        value={pwForm.next}
                        onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                        required
                        minLength={8}
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPw({ ...showPw, next: !showPw.next })}
                      >
                        {showPw.next ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
              {/* The policy the server enforces — see lib/password-policy. */}
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {PASSWORD_RULES.map((rule) => {
                        const met = rule.test(pwForm.next);
                        return (
                          <li key={rule.id} className="flex items-center gap-2">
                            <div
                              aria-hidden="true"
                              className={`h-1 w-1 rounded-full ${met ? 'bg-green-500' : 'bg-gray-400'}`}
                            />
                            <span className={met ? 'text-success-text' : undefined}>{rule.label}</span>
                            <span className="sr-only">{met ? ' — met' : ' — not met yet'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={showPw.confirm ? 'text' : 'password'}
                        value={pwForm.confirm}
                        onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPw({ ...showPw, confirm: !showPw.confirm })}
                      >
                        {showPw.confirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <Button type="submit" disabled={pwUpdating}>
                  {pwUpdating ? 'Changing Password...' : 'Change Password'}
                </Button>
              </form>
              <Separator />

              <div className="space-y-4">
                <h3 className="text-lg font-medium">Two-Factor Authentication</h3>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable 2FA</Label>
                    <p className="text-sm text-muted-foreground">
                      Add an extra layer of security to your account
                    </p>
                  </div>
                  <Badge variant="outline">Coming Soon</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appearance Tab */}
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
                    <Label>Compact mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Use smaller spacing between elements
                    </p>
                  </div>
                  <Switch
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
                    <Label>Show animations</Label>
                    <p className="text-sm text-muted-foreground">Enable interface animations</p>
                  </div>
                  <Switch
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
