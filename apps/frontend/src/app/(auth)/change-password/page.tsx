'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/rest-client';
import { safeReturnPath } from '@/lib/api/return-path';
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

/** The highest score each band covers; `STRENGTH_MAX` is the last one's `upTo`. */
const STRENGTH_MAX = 6;

/**
 * One table for the words AND the colour, because they used to disagree.
 *
 * The bar was driven by a seven-entry colour array and the words by a separate ladder of
 * thresholds, and the two did not line up: at score 4 the bar was already green while the
 * label read "Fair", and the two green steps either side of it ("Fair" green-500 and
 * "Good" green-600) measured 1.13:1 apart, which is no distinction at all.
 *
 * FILLS, measured against `bg-muted` — the track they sit directly on — with no compiled
 * utility in the way (see e2e/probe-strength-track.mjs; an earlier pass measured
 * uncompiled classes and read the absence of a rule as a pass):
 *
 *     bg-red-600     light 4.38   dark(bg-red-400)     5.24
 *     bg-orange-700  light 4.79   dark(bg-orange-500)  5.24
 *     bg-green-700   light 4.54   dark(bg-green-500)   6.82
 *
 * What they replace: yellow-500 measured 1.75:1 against the light track. At "Fair" —
 * the step somebody is most likely to be sitting on while they decide whether to keep
 * typing — the filled part of the bar was very nearly indistinguishable from the empty
 * part, which is the one thing the bar is for. 3:1 is the WCAG 1.4.11 floor.
 *
 * Excellent shares Good's green deliberately. A fourth hue would have to be another
 * green to keep the ramp legible, and two greens a person cannot tell apart imply a
 * distinction the colour does not actually carry. What separates Excellent is that the
 * bar is FULL, which is unmistakable, plus the word.
 */
const STRENGTH_BANDS = [
  { upTo: 2, label: 'Weak', hint: 'Add more characters and variety', fill: 'bg-red-600 dark:bg-red-400' },
  { upTo: 4, label: 'Fair', hint: 'Consider adding special characters', fill: 'bg-orange-700 dark:bg-orange-500' },
  { upTo: 5, label: 'Good', hint: 'Strong password', fill: 'bg-green-700 dark:bg-green-500' },
  { upTo: STRENGTH_MAX, label: 'Excellent', hint: 'Very strong password', fill: 'bg-green-700 dark:bg-green-500' },
] as const;

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, backendUnreachable, refreshUser, logout } = useAuth();

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

    const band = STRENGTH_BANDS.find((b) => score <= b.upTo) ?? STRENGTH_BANDS[0];
    feedback = `${band.label} - ${band.hint}`;

    setPasswordStrength({ score, feedback, color: band.fill });
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

      // Update password via the auth API. The server mails the account's owner
      // that it changed (AuthService.changePassword).
      await authClient.updatePassword(formData.newPassword, formData.currentPassword);
      await refreshUser();

      toast.success('Password changed successfully', {
        description: 'You can now access your account',
      });

      // On to where signing in was headed, when the forced change interrupted it.
      const destination = safeReturnPath(searchParams.get('next')) ?? '/dashboard';
      setTimeout(() => {
        router.push(destination);
      }, 1500);
    } catch (error: unknown) {
      // A wrong current password, or too many of them, is the form's to explain —
      // not a fault to put Next's dev overlay over the form for.
      if (!(error instanceof ApiError && error.code >= 400 && error.code < 500)) {
        logger.error('Password change error', { error });
      }

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
            <Alert className="mb-6 border-orange-500/50 bg-warning/10">
              <Lock className="h-4 w-4 text-warning-text" />
              <AlertDescription className="text-foreground">
                <strong>Security Required:</strong> You&apos;re using a temporary password. Please create
                a new secure password to protect your account.
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Password */}
            <div className="space-y-2">
              <Label htmlFor="currentPassword">
                {isForced || hasTempPassword ? 'Temporary password' : 'Current password'}
              </Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  autoComplete="current-password"
                  type={showPasswords.current ? 'text' : 'password'}
                  value={formData.currentPassword}
                  onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                  required
                  className="pr-10"
                  placeholder={
                    isForced || hasTempPassword
                      ? 'The one you were given'
                      : 'Enter your current password'
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPasswords({ ...showPasswords, current: !showPasswords.current })
                  }
                  aria-label={showPasswords.current ? 'Hide current password' : 'Show current password'}
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  autoComplete="new-password"
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
                  aria-label={showPasswords.new ? 'Hide new password' : 'Show new password'}
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {formData.newPassword && (
                <div className="space-y-2">
                  {/* Decorative: the line underneath says the same thing in words, and
                      announcing both would read the strength out twice on every keystroke. */}
                  <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`transition-all duration-(--duration-layout) ${passwordStrength.color}`}
                      style={{ width: `${(passwordStrength.score / STRENGTH_MAX) * 100}%` }}
                    />
                  </div>
                  {/* Polite, so it settles rather than interrupting mid-word: this text is
                      the only form the strength takes for somebody who cannot see the bar,
                      and it used to change in silence. */}
                  <p aria-live="polite" className="text-xs text-muted-foreground">
                    {passwordStrength.feedback}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  autoComplete="new-password"
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
                  aria-label={showPasswords.confirm ? 'Hide password confirmation' : 'Show password confirmation'}
                  className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            {/* A way back, and a way out. A voluntary change had no Cancel, and
                somebody made to change a temporary password — every other page
                sends them here — had no way to leave but closing the tab. */}
            {isForced || hasTempPassword ? (
              <Button type="button" variant="ghost" className="w-full" onClick={() => logout()}>
                Log out
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="w-full" asChild>
                <Link href="/settings?tab=security">Cancel</Link>
              </Button>
            )}
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
