'use client';

import { PageHeader } from '@/components/layout/page-header';

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
import { User, Mail, Shield, Calendar, Loader2 } from 'lucide-react';
import { formatDate, getInitials } from '@/lib/utils';
import { authClient, resources } from '@/lib/api/client';
import { toast } from 'sonner';

export default function ProfilePage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const { currentWorkspace } = useCurrentWorkspace();
  const userRole = useUserRole();

  const [isEditing, setIsEditing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [name, setName] = React.useState(user?.name || '');
  const [email, setEmail] = React.useState(user?.email || '');

  React.useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setIsSaving(true);
    try {
      // Update auth profile name
      await authClient.updateName(name.trim());

      // Update user document in database
      await resources.update('users', user.id, {
        name: name.trim(),
      });

      // Refresh auth context so header/avatar updates
      await refreshUser();

      toast.success('Profile updated successfully');
      setIsEditing(false);
    } catch (error: any) {
      toast.error('Failed to update profile', {
        description: error?.message || 'Please try again',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
    }
    setIsEditing(false);
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center">
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Profile Settings"
        description="Manage your personal information and preferences"
      />

      {/* Profile Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your profile details and preferences</CardDescription>
            </div>
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            )}
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
              {userRole && <Badge variant="outline">{ROLE_CONFIG[userRole].label}</Badge>}
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
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isEditing}
                placeholder="Enter your full name"
              />
            </div>

            {/* Email */}
            <div className="grid gap-2">
              <Label htmlFor="email">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email Address
                </div>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={true} // Email is read-only for now
                placeholder="your.email@example.com"
              />
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
                {userRole ? (
                  <Badge variant="secondary">{ROLE_CONFIG[userRole].label}</Badge>
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
