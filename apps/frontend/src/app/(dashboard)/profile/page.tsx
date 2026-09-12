'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PageLoader } from '@/components/ui/page-loader';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useUserRole } from '@/hooks/use-permissions';
import { ROLE_CONFIG } from '@/hooks/use-team';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { User, Mail, Shield, Calendar } from 'lucide-react';
import { formatDate, getInitials } from '@/lib/utils';

export default function ProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const userRole = useUserRole();

  // A workspace can define custom WorkspaceRoles, and workspace-members.service
  // writes those names straight onto a membership, so the role is NOT guaranteed
  // to be one of the seven built-in keys. Indexing ROLE_CONFIG blind threw
  // "cannot read properties of undefined (reading 'label')" and took the whole
  // page down for anyone on a custom role — fall back to the role name itself.
  const roleLabel = userRole
    ? ((ROLE_CONFIG as Record<string, { label: string } | undefined>)[userRole]?.label ?? userRole)
    : null;

  // Read-only view. Editing lives in Settings → Profile, which owns the avatar
  // upload and the password form too; this page used to write the same name
  // through a SECOND endpoint, so the two screens could drift apart.
  if (!user) {
    return <PageLoader message="Loading profile..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Profile"
        description="Your personal information and workspace role"
      />

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Edit these details in Settings</CardDescription>
            </div>
            <Button onClick={() => router.push('/settings?tab=profile')}>Edit Profile</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Section */}
          <div className="flex items-center gap-6">
            <Avatar className="h-24 w-24">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="text-2xl">{getInitials(user.name || 'U')}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h3 className="font-semibold">{user.name}</h3>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              {roleLabel && <Badge variant="outline">{roleLabel}</Badge>}
            </div>
          </div>

          <Separator />

          {/* Profile Fields */}
          <div className="grid gap-6">
            {/* Name */}
            <div className="grid gap-2">
              <Label htmlFor="name">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Full Name
                </div>
              </Label>
              <Input id="name" value={user.name || ''} disabled readOnly />
            </div>

            {/* Email */}
            <div className="grid gap-2">
              <Label htmlFor="email">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Address
                </div>
              </Label>
              <Input id="email" type="email" value={user.email || ''} disabled readOnly />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed. Contact support if you need to update it.
              </p>
            </div>

            {/* Role (Read-only) */}
            <div className="grid gap-2">
              <Label>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Role in {currentWorkspace?.name || 'Workspace'}
                </div>
              </Label>
              <div className="flex items-center gap-2 p-3 rounded-md border bg-muted">
                {roleLabel ? (
                  <Badge variant="secondary">{roleLabel}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">No role assigned</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Your role is managed by workspace administrators.
              </p>
            </div>

            {/* Account Created */}
            <div className="grid gap-2">
              <Label>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Account Created
                </div>
              </Label>
              <div className="p-3 rounded-md border bg-muted">
                <p className="text-sm">{formatDate(user.createdAt)}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password Change Card */}
      <Card>
        <CardHeader>
          <CardTitle>Password &amp; Security</CardTitle>
          <CardDescription>Manage your password and security settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Keep your account secure by using a strong, unique password.
            </p>
            <Button variant="outline" onClick={() => router.push('/change-password')}>
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
