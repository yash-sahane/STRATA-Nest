'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { useHydrated } from '@/hooks/use-hydrated';
import { ApiError } from '@/lib/api/rest-client';
import { isThrottled, retryWait } from '@/lib/api/rate-limit';
import { currentReturnPath } from '@/lib/api/return-path';

/**
 * Why signing in failed, in words somebody can act on.
 *
 * The request throttler's 429 arrived as "ThrottlerException: Too Many Requests";
 * the account lockout's 429 already explains itself (and offers a reset), as does
 * the wrong-password answer, so those keep the API's words.
 */
function signInFailure(error: unknown): string {
  if (isThrottled(error)) {
    return `Too many sign-in attempts from this device. Try again ${retryWait(error, 'in a minute')}.`;
  }
  if (error instanceof ApiError) {
    if (error.code >= 500) return 'Something went wrong on the server. Try again in a moment.';
    return error.message || 'Sign-in failed. Check your email and password.';
  }
  // fetch's own failure: the request never reached the API.
  return "Can't reach the server. Check your connection and try again.";
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  /**
   * Shown beside the form, not in a toast. A toast in the far corner of the screen
   * is the last place somebody looking at a password field reads, and it was gone
   * a few seconds later; an alert here is announced to a screen reader as well.
   */
  const [failure, setFailure] = useState<string | null>(null);
  const { login } = useAuth();
  // See useHydrated: submitted before this page was live, the form went out as
  // GET /login?email=…&password=… — the password in the address bar and history.
  const hydrated = useHydrated();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read from the form, not from state: the fields are the browser's, so what
    // was typed (or filled by a password manager) before the page was live is
    // still what is sent. Read before `loading` disables them — a disabled field
    // is not part of the form's data.
    const fields = new FormData(e.currentTarget);
    const email = String(fields.get('email') ?? '');
    const password = String(fields.get('password') ?? '');
    setFailure(null);
    setLoading(true);

    try {
      // The page the session ran out on, when the shell sent us here from one.
      await login(email, password, currentReturnPath());
      toast.success('Welcome back!');
    } catch (error: unknown) {
      setFailure(signInFailure(error));
    } finally {
      setLoading(false);
    }
  };

  // The page background is tokenized, matching change-password /
  // forgot-password / reset-password. This was the last raw-palette gradient in
  // the auth flow, so the background visibly jumped between sign-in and
  // "Forgot password?" — the same screen repainted a different colour, one
  // click apart.
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          {/* The product's own mark and name. This tile used to read "PC" — the
              initials of nothing in this app — so the first screen anybody sees
              did not say what they were signing in to. Same asset and treatment
              as the sidebar. */}
          <div className="mb-4 flex items-center justify-center gap-2">
            <img
              src="/logo.svg"
              alt=""
              className="h-10 w-10 dark:invert dark:brightness-0 dark:contrast-200"
            />
            <span className="text-xl font-semibold">STRATA</span>
          </div>
          {/* The page's heading. CardTitle renders an h3, which left the sign-in
              page with no h1 at all — nothing for a screen reader's heading
              navigation to land on first. Same look as CardTitle. */}
          <h1 className="text-2xl font-bold leading-none tracking-tight">Welcome Back</h1>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={handleSubmit} className="space-y-4">
            {failure && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                // `username`, with `current-password` below: together they tell a
                // password manager this is a SIGN-IN and the saved credential applies.
                // Neither field carried a name or an autocomplete hint, so saving and
                // filling were both unreliable.
                autoComplete="username"
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {/* The API has mailed reset links since the beginning, but no
                    screen ever asked for one — a locked-out user's only route
                    back in was an administrator. */}
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !hydrated}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <p>Accounts are created by a workspace manager.</p>
            <p className="mt-1">Ask yours to add you if you do not have one yet.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
