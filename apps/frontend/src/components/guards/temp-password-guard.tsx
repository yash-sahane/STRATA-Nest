'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { PageLoader } from '@/components/ui/page-loader';

/**
 * "You must change your temporary password to continue" has to be a gate, not
 * a suggestion.
 *
 * Only the post-login redirect in auth-provider implemented the force, so any
 * navigation escaped it — typing /dashboard, a bookmark, a link out of a
 * notification e-mail — and the account went on working indefinitely on a
 * password that had been mailed in plaintext. The API now refuses every route
 * but `auth/me`, `change-password` and `logout` for such a session; this is
 * the matching client half, so the user meets the form instead of a wall of
 * 403s.
 */
export function TempPasswordGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const mustChangePassword = !loading && user?.hasTempPassword === true;

  useEffect(() => {
    // replace(), not push(): the screen they were bounced off is not somewhere
    // the Back button should be able to return them to.
    if (mustChangePassword) router.replace('/change-password?forced=true');
  }, [mustChangePassword, router]);

  // Hold the shell back while the redirect is in flight. Rendering it would
  // mount the providers and fire the workspace/project queries the API is
  // about to refuse, and the guards downstream would report those refusals as
  // load failures.
  if (mustChangePassword) {
    return <PageLoader message="Redirecting to change your password…" />;
  }

  return <>{children}</>;
}
