'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces, useJoinWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { AlertTriangle, Loader2, Users } from 'lucide-react';
import { RequestAccessForm } from '@/components/guards/request-access-form';
import { TempPasswordGuard } from '@/components/guards/temp-password-guard';

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
  const joinWorkspace = useJoinWorkspace();
  const [inviteCode, setInviteCode] = useState('');

  // A failed workspace fetch is an ERROR, not an answer. React Query leaves
  // `data` undefined once it has exhausted its retries, and reading that as
  // "this account belongs to no workspace" threw the whole app into first-run
  // onboarding over one 500: an admin with live workspaces was pushed to
  // /onboarding and asked to "Create Your Workspace", and a member was told
  // they were in none. `isError` is consulted first, and the array is only
  // trusted when it actually arrived.
  const hasNoWorkspace = !!user && !isError && Array.isArray(workspaces) && workspaces.length === 0;
  // Only administrators may create one, and /onboarding bounces everyone else
  // straight back here — redirecting a non-admin would ping-pong forever.
  const canOnboard = user?.isAdmin === true;

  useEffect(() => {
    if (!authLoading && !workspacesLoading && hasNoWorkspace && canOnboard) {
      router.push('/onboarding');
    }
  }, [hasNoWorkspace, canOnboard, authLoading, workspacesLoading, router]);

  if (authLoading || workspacesLoading) {
    return <PageLoader />;
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;
    try {
      await joinWorkspace.mutateAsync({ inviteCode: code });
      // A full navigation, not router.refresh(): every provider needs to
      // re-read the workspace list it cached while the user had none.
      window.location.href = '/dashboard';
    } catch {
      // the mutation surfaces the reason as a toast
    }
  };

  if (isError) {
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
            <CardTitle>No workspace yet</CardTitle>
            <CardDescription>
              You are not a member of any workspace. Enter an invite code, or request access to
              one and a manager will review it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* The API has accepted invite codes at
                POST /workspaces/accept-invitation since the beginning, but this
                screen offered no way to enter one — a user holding a valid code
                had no path forward from here except asking to be added by hand. */}
            <form onSubmit={handleJoin} className="space-y-2">
              {/* Both kinds of secret land here — see useJoinWorkspace, which
                  routes by shape — so the label should not promise only one. */}
              <Label htmlFor="invite-code">Invite code or invitation link token</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="e.g. VCWVFFSF-Y"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={joinWorkspace.isPending}
                />
                <Button type="submit" disabled={!inviteCode.trim() || joinWorkspace.isPending}>
                  {joinWorkspace.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Joining
                    </>
                  ) : (
                    'Join'
                  )}
                </Button>
              </div>
            </form>

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
