'use client';

import * as React from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/rest-client';
import { isThrottled, retryWait } from '@/lib/api/rate-limit';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * The self-service half of the password reset.
 *
 * `POST /auth/password-reset` has always mailed a link, but nothing in the
 * product ever called it: the login page offered no way in, so a user who was
 * locked out — including anyone whose address was stored in a different case
 * than they typed it — had no recovery at all short of an administrator.
 */
export default function ForgotPasswordPage() {
  /** The address the last link was asked for: named in the answer, and offered back to edit. */
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  // Submitted before the page is live, the browser reloads it and the address is lost.
  const hydrated = useHydrated();
  const [sent, setSent] = React.useState(false);
  /**
   * False when the API says it cannot send mail at all. This screen used to
   * answer "a reset link is on its way" regardless — on an installation with no
   * mail provider, that is a promise to somebody who will wait for it forever,
   * with no hint that there is another way back in.
   */
  const [delivers, setDelivers] = React.useState(true);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // From the form, so an address typed before the page was live is the one
    // asked for (see the sign-in page).
    const address = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!address) return;
    setEmail(address);
    setLoading(true);

    try {
      const answer = await authClient.requestPasswordReset(address);
      setDelivers(answer.delivers);
      // The API answers the same for a known and an unknown address on
      // purpose, so this screen must not distinguish them either — saying "no
      // such account" here would turn the form into an account-enumeration
      // oracle.
      setSent(true);
    } catch (error: unknown) {
      // An expected refusal is not a fault, and logging it as one put Next's dev
      // overlay over the form (see the sign-in page).
      if (!(error instanceof ApiError && error.code >= 400 && error.code < 500)) {
        logger.error('Password reset request failed', { error });
      }
      // Reset requests are limited to a handful an hour. The raw throttler
      // message ("ThrottlerException: Too Many Requests") tells a locked-out
      // user nothing about what to do next.
      if (isThrottled(error)) {
        toast.error('Too many reset requests', {
          description: `Try again ${retryWait(error, 'in an hour')}.`,
        });
      } else {
        toast.error(
          (error instanceof Error ? error.message : String(error)) ||
            'Could not send the reset email. Please try again.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            {sent ? (
              <MailCheck className="h-8 w-8 text-primary" />
            ) : (
              <KeyRound className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {!sent
              ? 'Forgot your password?'
              : delivers
                ? 'Check your email'
                : 'Email is not set up here'}
          </CardTitle>
          <CardDescription>
            {!sent
              ? 'Enter the address you sign in with and we will email you a link to set a new password.'
              : delivers
                ? 'The link is valid for one hour and can be used once.'
                : 'This installation cannot send email, so no link has been sent.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <>
              {delivers ? (
                <Alert>
                  <MailCheck className="h-4 w-4" />
                  <AlertDescription>
                    If an account exists for <strong>{email}</strong>, a reset link is on
                    its way. It can take a minute to arrive — check your spam folder before trying
                    again.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <KeyRound className="h-4 w-4" />
                  <AlertDescription>
                    Ask a platform administrator to reset your password: they issue a temporary
                    password from the Team page. If you have never signed in, whoever manages your
                    workspace can do it too.
                  </AlertDescription>
                </Alert>
              )}
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                Use a different address
              </Button>
            </>
          ) : (
            <form method="post" onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  defaultValue={email}
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !hydrated}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending link...
                  </>
                ) : (
                  'Send reset link'
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
