'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { AlertTriangle, Loader2, Users } from 'lucide-react';
import { RequestAccessForm } from '@/components/guards/request-access-form';
import { InviteCodeForm } from '@/components/workspace/invite-code-form';
import { TempPasswordGuard } from '@/components/guards/temp-password-guard';
import { useQueryClient } from '@tanstack/react-query';
import { RecentNotices } from '@/components/guards/recent-notices';

/**
 * The membership check runs BEHIND the temporary-password gate, not beside it.
 * A user who still holds a mailed temporary password is refused the workspace
 * list by the API, and this guard would have read that refusal as "could not
 * load your workspaces" — a connection error — instead of the one thing they
 * actually have to do. Nesting keeps the queries below from mounting at all
 * until the password has been replaced.
 */
export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  return (
    <TempPasswordGuard>
      <WorkspaceMembershipGuard>{children}</WorkspaceMembershipGuard>
    </TempPasswordGuard>
  );
}

function WorkspaceMembershipGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const {
    data: workspaces,
    isLoading: workspacesLoading,
    isError,
    isFetching,
    refetch,
  } = useWorkspaces(user?.id);
  // A failed workspace fetch is an ERROR, not an answer. React Query leaves
  // `data` undefined once it has exhausted its retries, and reading that as
  // "this account belongs to no workspace" threw the whole app into first-run
  // onboarding over one 500: an admin with live workspaces was pushed to
  // /onboarding and asked to "Create Your Workspace", and a member was told
  // they were in none. `isError` is consulted first, and the array is only
  // trusted when it actually arrived.
  //
  // ...and once it HAS arrived, a later failure does not take it away. React
  // Query flags `isError` for a failed background refetch too, with the last
  // good list still in `data`: one blip in a long-open tab (a deploy restarting
  // the API, a realtime-triggered refetch on a bad moment) swapped the whole app
  // for "Could not load your workspaces" over a list it was holding, and while
  // somebody waited on "No workspace open to you" a single failed 30-second poll
  // did the same and stopped the polling with it. The blocking card is for a
  // list that never came; a refetch that fails keeps the last one.
  const listed = Array.isArray(workspaces) ? workspaces : undefined;
  const loadFailed = isError && listed === undefined;
  const hasNoWorkspace = !!user && listed !== undefined && listed.length === 0;
  // Only administrators may create one, and /onboarding bounces everyone else
  // straight back here — redirecting a non-admin would ping-pong forever.
  const canOnboard = user?.isAdmin === true;

  useEffect(() => {
    if (!authLoading && !workspacesLoading && hasNoWorkspace && canOnboard) {
      router.push('/onboarding');
    }
  }, [hasNoWorkspace, canOnboard, authLoading, workspacesLoading, router]);

  /**
   * Somebody waiting here is waiting on another person: a manager approving
   * their request, or adding them. Nothing told this screen when that happened,
   * so they sat on "No workspace yet" until they thought to press Reload.
   *
   * Ask again every half minute while the card is up, and leave the moment a
   * workspace appears — by a full navigation, for the same reason as after
   * redeeming a code: every provider cached "none" and has to re-read.
   */
  const waited = useRef(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!hasNoWorkspace || canOnboard) return;
    waited.current = true;
    // The directory as well: it says whether a request was declined, which the
    // card otherwise went on calling "awaiting a decision" until a reload.
    const timer = window.setInterval(() => {
      void refetch();
      void queryClient.invalidateQueries({ queryKey: ['workspace-directory'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hasNoWorkspace, canOnboard, refetch, queryClient]);
  useEffect(() => {
    if (waited.current && Array.isArray(workspaces) && workspaces.length > 0) {
      window.location.href = '/dashboard';
    }
  }, [workspaces]);

  if (authLoading || workspacesLoading) {
    return <PageLoader />;
  }

  if (loadFailed) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <AlertTriangle className="h-10 w-10 text-destructive-text" />
            <CardTitle>Could not load your workspaces</CardTitle>
            <CardDescription>
              The workspace list did not come back. Your workspaces are still there — this is a
              connection problem, not a change to your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-2">
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Retrying
                </>
              ) : (
                'Try again'
              )}
            </Button>
            <Button variant="outline" onClick={() => logout()}>
              Log out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (hasNoWorkspace) {
    // Admins are being redirected to /onboarding; everyone else needs an invite,
    // so give them a terminal state rather than a blank screen.
    if (canOnboard) return null;

    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <Users className="h-10 w-10 text-muted-foreground/60" />
            <CardTitle>No workspace open to you</CardTitle>
            <CardDescription>
              Enter an invite code, or request access to a workspace and one of its managers will
              review it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Why there is nothing here, when something happened: removed,
                switched off, declined. Those notices were written — filed under
                the workspace lost — and this screen, which has no header and no
                bell, never showed them. */}
            <RecentNotices />
            {/* The API has accepted invite codes at
                POST /workspaces/accept-invitation since the beginning, but this
                screen offered no way to enter one — a user holding a valid code
                had no path forward from here except asking to be added by hand. */}
            <InviteCodeForm
              onJoined={() => {
                // A full navigation, not router.refresh(): every provider needs
                // to re-read the workspace list it cached while the user had none.
                window.location.href = '/dashboard';
              }}
            />

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* No code? Ask a manager directly. */}
            <RequestAccessForm />
            <p className="text-center text-xs text-muted-foreground">
              This page opens your workspace by itself once you have been let in.
            </p>

            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button variant="outline" onClick={() => logout()}>
                Log out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
