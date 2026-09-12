'use client';

import * as React from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/rest-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

/**
 * The self-service half of the password reset.
 *
 * `POST /auth/password-reset` has always mailed a link, but nothing in the
 * product ever called it: the login page offered no way in, so a user who was
 * locked out — including anyone whose address was stored in a different case
 * than they typed it — had no recovery at all short of an administrator.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await authClient.requestPasswordReset(email.trim());
      // The API answers the same for a known and an unknown address on
      // purpose, so this screen must not distinguish them either — saying "no
      // such account" here would turn the form into an account-enumeration
      // oracle.
      setSent(true);
    } catch (error: unknown) {
      logger.error('Password reset request failed', { error });
      // Reset requests are limited to a handful an hour. The raw throttler
      // message ("ThrottlerException: Too Many Requests") tells a locked-out
      // user nothing about what to do next.
      if (error instanceof ApiError && error.code === 429) {
        toast.error('Too many reset requests', {
          description: 'Wait an hour before asking for another link.',
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
            {sent ? 'Check your email' : 'Forgot your password?'}
          </CardTitle>
          <CardDescription>
            {sent
              ? 'The link is valid for one hour and can be used once.'
              : 'Enter the address you sign in with and we will email you a link to set a new password.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <>
              <Alert>
                <MailCheck className="h-4 w-4" />
                <AlertDescription>
                  If an account exists for <strong>{email.trim()}</strong>, a reset link is on its
                  way. It can take a minute to arrive — check your spam folder before trying again.
                </AlertDescription>
              </Alert>
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
                Use a different address
              </Button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
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
