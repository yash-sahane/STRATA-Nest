'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/api/client';
import { PASSWORD_RULES, passwordFailures } from '@/lib/password-policy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

/**
 * The other end of the emailed reset link.
 *
 * `requestPasswordReset()` has always built `/reset-password?uid=…&token=…`,
 * but that route did not exist — every reset email the API sent landed on the
 * app's 404 page, so the reset endpoints were implemented and unreachable.
 */
function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const uid = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPasswords, setShowPasswords] = React.useState({ next: false, confirm: false });
  const [loading, setLoading] = React.useState(false);
  // A dead link is a terminal state, not a retryable form: the only way out is
  // a fresh email, so stop offering the fields once the API has rejected it.
  const [linkRejected, setLinkRejected] = React.useState(false);

  const linkPresent = Boolean(uid && token);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Every failed rule at once. This form's token is one-time, so bouncing
    // off the server one rule at a time is a particularly bad place to do it.
    const failures = passwordFailures(newPassword);
    if (failures.length > 0) {
      toast.error(`Password must have: ${failures.join(', ')}.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await authClient.confirmPasswordReset(uid, token, newPassword);
      toast.success('Password updated', { description: 'Sign in with your new password.' });
      router.push('/login');
    } catch (error: unknown) {
      logger.error('Password reset failed', { error });
      const message = error instanceof Error ? error.message : String(error);
      // The API distinguishes a malformed `uid` from a spent or expired token;
      // both mean this link is finished, and telling the user to "try again"
      // with the same one would loop them forever.
      if (/invalid reset link|invalid or expired token/i.test(message)) {
        setLinkRejected(true);
      } else {
        toast.error('Could not reset your password', {
          description: message || 'Please try again',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const linkDead = !linkPresent || linkRejected;

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            {linkDead ? (
              <ShieldAlert className="h-8 w-8 text-destructive-text" />
            ) : (
              <Lock className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {linkDead ? 'This link no longer works' : 'Set a new password'}
          </CardTitle>
          <CardDescription>
            {linkDead
              ? 'Reset links expire after an hour and can only be used once.'
              : 'Choose a password you have not used on this account before.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkDead ? (
            <>
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>
                  {linkPresent
                    ? 'That reset link has already been used or has expired. Request a new one and use the most recent email.'
                    : 'This address is missing the reset details. Open the link straight from the email, or request a new one.'}
                </AlertDescription>
              </Alert>
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPasswords.next ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="pr-10"
                    placeholder="Enter your new password"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowPasswords({ ...showPasswords, next: !showPasswords.next })
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPasswords.next ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
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
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive-text">Passwords do not match</p>
                )}
                {confirmPassword && newPassword === confirmPassword && (
                  <p className="text-xs text-success-text flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Passwords match
                  </p>
                )}
              </div>

              {/* The policy the server enforces — see lib/password-policy. */}
              <ul className="text-xs text-muted-foreground space-y-1">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(newPassword);
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

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating password...
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" />
                    Update password
                  </>
                )}
              </Button>
            </form>
          )}

          <Link
            href="/login"
            className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
