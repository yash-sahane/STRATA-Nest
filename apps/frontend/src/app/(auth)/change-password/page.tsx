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
import { PASSWORD_RULES, passwordFailures } from '@/lib/password-policy';
import Link from 'next/link';

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, backendUnreachable, refreshUser } = useAuth();

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

  // No redirect here on purpose. Bouncing a signed-in visitor to /dashboard is
  // what made the profile page's "Change Password" button dead: it pushed this
  // route, this effect pushed straight back, and the click looked like nothing
  // but a flash. Changing your own password on purpose is the ordinary case.

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
      // Validation. Every failed rule at once: correcting them one per
      // submission is four round trips to learn what the checklist already
      // showed, and the server refuses the same set.
      const failures = passwordFailures(formData.newPassword);
      if (failures.length > 0) {
        toast.error(`Password must have: ${failures.join(', ')}.`);
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

      // Best-effort courtesy e-mail: the password has ALREADY been changed, so
      // a network failure here must never reach the catch below and tell the
      // user the change failed.
      try {
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
      } catch (error) {
        logger.error('Password change notification e-mail failed', { error });
      }

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

  // Spin only while the answer is genuinely outstanding. `user === null` after
  // the provider has settled is an ANSWER — nobody is signed in — and showing
  // "Loading..." for it left a signed-out visitor on a spinner with no way
  // forward and no way back but the browser's own button.
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            {/* The provider distinguishes "401, nobody is signed in" from "the
                request never got an answer". Telling somebody they are signed
                out when the server is simply down sends them to a login form
                that cannot work either. */}
            <CardTitle className="text-2xl">
              {backendUnreachable ? 'Cannot reach the server' : 'Sign in to change your password'}
            </CardTitle>
            <CardDescription>
              {backendUnreachable
                ? 'Your session could not be checked because the server did not answer. Your sign-in may still be valid — try again in a moment.'
                : 'Changing a password needs the current one, so this page is only available while you are signed in.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {backendUnreachable ? (
              <Button className="w-full" onClick={() => window.location.reload()}>
                Try again
              </Button>
            ) : (
              <>
                <Button asChild className="w-full">
                  <Link href="/login">Go to sign in</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/forgot-password">I&apos;ve forgotten my password</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
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
              <Lock className="h-4 w-4 text-warning-text" />
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
                <p className="text-xs text-destructive-text">Passwords do not match</p>
              )}
              {formData.confirmPassword && formData.newPassword === formData.confirmPassword && (
                <p className="text-xs text-success-text flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Passwords match
                </p>
              )}
            </div>

            {/* Password Requirements */}
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-sm font-medium mb-2">Password Requirements:</p>
              {/* One list, shared with the policy the server enforces — see
                  lib/password-policy. A dot that is not merely decorative also
                  needs to reach a screen reader, hence the per-item state. */}
              <ul className="text-xs text-muted-foreground space-y-1">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(formData.newPassword);
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
