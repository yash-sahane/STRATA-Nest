'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/api/client';
import { useAuth } from '@/components/providers/auth-provider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock, Eye, EyeOff, Loader2, Shield, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshUser } = useAuth();

  const [formData, setFormData] = React.useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [showPasswords, setShowPasswords] = React.useState({
    current: false,
    new: false,
    confirm: false,
  });

  const [loading, setLoading] = React.useState(false);
  const [passwordStrength, setPasswordStrength] = React.useState({
    score: 0,
    feedback: '',
    color: '',
  });

  const isForced = searchParams.get('forced') === 'true';
  const hasTempPassword = user?.hasTempPassword === true;

  // Redirect if not forced and the user does not have a temporary password.
  React.useEffect(() => {
    if (!isForced && user && !hasTempPassword) {
      router.push('/dashboard');
    }
  }, [isForced, hasTempPassword, router, user]);

  // Calculate password strength
  React.useEffect(() => {
    const password = formData.newPassword;
    if (!password) {
      setPasswordStrength({ score: 0, feedback: '', color: '' });
      return;
    }

    let score = 0;
    let feedback = '';

    // Length check
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;

    // Complexity checks
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    // Determine feedback
    if (score <= 2) {
      feedback = 'Weak - Add more characters and variety';
    } else if (score <= 4) {
      feedback = 'Fair - Consider adding special characters';
    } else if (score <= 5) {
      feedback = 'Good - Strong password';
    } else {
      feedback = 'Excellent - Very strong password';
    }

    const colors = [
      'bg-red-500',
      'bg-red-500',
      'bg-orange-500',
      'bg-yellow-500',
      'bg-green-500',
      'bg-green-600',
      'bg-emerald-600',
    ];

    setPasswordStrength({
      score,
      feedback,
      color: colors[score] || 'bg-gray-300',
    });
  }, [formData.newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validation
      if (formData.newPassword.length < 8) {
        toast.error('Password must be at least 8 characters');
        return;
      }

      if (formData.newPassword !== formData.confirmPassword) {
        toast.error('Passwords do not match');
        return;
      }

      if (formData.newPassword === formData.currentPassword) {
        toast.error('New password must be different from current password');
        return;
      }

      if (!user) {
        toast.error('User not found');
        return;
      }

      // Update password via the auth API.
      await authClient.updatePassword(formData.newPassword, formData.currentPassword);
      await refreshUser();

      await fetch('/api/send-notification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          notificationTitle: 'Password changed',
          notificationMessage: 'Your password was changed successfully.',
        }),
      });

      toast.success('Password changed successfully', {
        description: 'You can now access your account',
      });

      // Redirect to dashboard
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } catch (error: any) {
      logger.error('Password change error', { error });

      if (
        (error instanceof Error ? error.message : String(error))?.includes('Invalid credentials')
      ) {
        toast.error('Current password is incorrect');
      } else {
        toast.error('Failed to change password', {
          description:
            (error instanceof Error ? error.message : String(error)) || 'Please try again',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Change Your Password</CardTitle>
          <CardDescription>
            {isForced || hasTempPassword
              ? 'You must change your temporary password to continue'
              : 'Create a new password for your account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(isForced || hasTempPassword) && (
            <Alert className="mb-6 border-orange-500/50 bg-orange-50 dark:bg-orange-950/20">
              <Lock className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-900 dark:text-orange-100">
                <strong>Security Required:</strong> You&apos;re using a temporary password. Please create
                a new secure password to protect your account.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showPasswords.current ? 'text' : 'password'}
                  value={formData.currentPassword}
                  onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                  required
                  className="pr-10"
                  placeholder="Enter your current password"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPasswords({ ...showPasswords, current: !showPasswords.current })
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPasswords.current ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPasswords.new ? 'text' : 'password'}
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                  required
                  className="pr-10"
                  placeholder="Enter your new password"
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {formData.newPassword && (
                <div className="space-y-2">
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{passwordStrength.feedback}</p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showPasswords.confirm ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  required
                  className="pr-10"
                  placeholder="Confirm your new password"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPasswords.confirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {formData.confirmPassword && formData.newPassword !== formData.confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
              {formData.confirmPassword && formData.newPassword === formData.confirmPassword && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Passwords match
                </p>
              )}
            </div>

            {/* Password Requirements */}
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm font-medium mb-2">Password Requirements:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${
                      formData.newPassword.length >= 8 ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  At least 8 characters
                </li>
                <li className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${
                      /[A-Z]/.test(formData.newPassword) ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  One uppercase letter
                </li>
                <li className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${
                      /[a-z]/.test(formData.newPassword) ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  One lowercase letter
                </li>
                <li className="flex items-center gap-2">
                  <div
                    className={`h-1 w-1 rounded-full ${
                      /[0-9]/.test(formData.newPassword) ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                  One number
                </li>
              </ul>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Changing Password...
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Change Password
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <ChangePasswordContent />
    </Suspense>
  );
}
