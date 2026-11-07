'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/rest-client';
import { closeRealtime } from '@/lib/api/realtime-client';
import { isPublicAuthRoute, safeReturnPath } from '@/lib/api/return-path';
import { announceSignedOut, onSignedOutElsewhere } from '@/lib/api/session-events';
import { User } from '@/types';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiModels } from '@/lib/api/client';
import { logger } from '@/lib/logger';

interface AuthContextType {
  user: User | null;
  session: ApiModels.Session | null;
  /**
   * "The session is not resolved yet" — which on the signed-out routes in
   * PUBLIC_AUTH_ROUTES stays true for as long as you are on them, because the
   * probe is deferred there rather than answered. Read it as "don't act on
   * `user` yet", never as "signed in".
   */
  loading: boolean;
  /**
   * The session could not be established because the API could not be reached
   * — distinct from "not signed in". Without this the shell treats a backend
   * outage as a logout and sends the user to /login, where signing in also
   * fails and nothing explains why.
   */
  backendUnreachable: boolean;
  /**
   * The session was ended on purpose — "Log out", in this tab or another — rather
   * than lost. The shell sends a LOST session to /login with the page to come
   * back to; after a deliberate sign-out the next person to sign in on this
   * machine should not land on the last one's page.
   */
  signedOut: boolean;
  /** `next`: where to land afterwards, if it is a page on this site (see safeReturnPath). */
  login: (email: string, password: string, next?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type CurrentUser = ApiModels.User & Partial<User>;

// PUBLIC_AUTH_ROUTES — the signed-out screens, where the session is not asked
// about — lives in lib/api/return-path, which also needs it.

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<ApiModels.Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  // Whether the session has been asked about at all yet. A ref, not state,
  // because it must gate the effect without re-running it.
  const probedRef = useRef(false);

  // The `/api/v1/auth/me/` endpoint returns the profile, session, and workspace
  // membership fields used by the app in a single round-trip.
  const loadUser = async (): Promise<CurrentUser | null> => {
    try {
      const currentSession = await authClient.getCurrentSession();
      setSession(currentSession);

      const currentUser = (await authClient.getCurrentUser()) as CurrentUser;
      const now = new Date().toISOString();
      const userData: User = {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        phone: currentUser.phone,
        avatar: currentUser.avatar,
        role: currentUser.role || 'SOFTWARE_DEVELOPER',
        workspaceId: currentUser.workspaceId || '',
        workspaceIds: Array.isArray(currentUser.workspaceIds) ? currentUser.workspaceIds : [],
        hasTempPassword: currentUser.hasTempPassword === true,
        isAdmin: currentUser.isAdmin === true,
        mailDelivers: (currentUser as { mailDelivers?: boolean }).mailDelivers !== false,
        status: currentUser.status || 'ACTIVE',
        createdAt: currentUser.createdAt || now,
        updatedAt: currentUser.updatedAt || now,
      };
      setUser(userData);
      setBackendUnreachable(false);
      setSignedOut(false);
      return currentUser;
    } catch (error) {
      // A 401 means the session is genuinely gone (the client already tried a
      // token refresh before surfacing it). Anything else — the API being down,
      // DNS failing, a 5xx — leaves the session unknown, not invalid, so the
      // user must not be treated as logged out.
      const isUnauthenticated = error instanceof ApiError && error.code === 401;
      setBackendUnreachable(!isUnauthenticated);
      setUser(null);
      setSession(null);
      return null;
    } finally {
      probedRef.current = true;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (probedRef.current) return;
    // On a signed-out route the session is left *deferred*, not resolved:
    // `loading` stays true so that navigating off one of these pages re-runs
    // this effect and probes then. Resolving to "not signed in" here instead
    // would let DashboardLayout — whose effect runs before this one, being the
    // child — bounce a visitor who does hold a valid cookie straight back to
    // /login on the first client-side navigation.
    if (isPublicAuthRoute(pathname)) return;
    probedRef.current = true;
    loadUser();
  }, [pathname]);

  // Another tab signed out, and the cookies went with it. What this tab holds —
  // the last user's cached answers, a socket still streaming frames — goes too.
  useEffect(
    () =>
      onSignedOutElsewhere(() => {
        closeRealtime();
        authClient.forget();
        queryClient.clear();
        setSignedOut(true);
        setUser(null);
        setSession(null);
        if (!isPublicAuthRoute(window.location.pathname)) router.push('/login');
      }),
    [queryClient, router]
  );

  const login = async (email: string, password: string, next?: string | null) => {
    try {
      await authClient.login(email, password);
      const currentUser = await loadUser();
      const destination = safeReturnPath(next) ?? '/dashboard';

      if (!currentUser) {
        router.push('/dashboard');
        return;
      }

      if (currentUser.hasTempPassword === true) {
        // The destination waits on the other side of the forced change.
        router.push(
          destination === '/dashboard'
            ? '/change-password?forced=true'
            : `/change-password?forced=true&next=${encodeURIComponent(destination)}`
        );
        return;
      }

      const workspaceIds: string[] = Array.isArray(currentUser.workspaceIds)
        ? currentUser.workspaceIds
        : [];

      if (workspaceIds.length === 0) {
        if (currentUser.isAdmin === true) {
          router.push('/onboarding');
          return;
        }
        // Not a failure: the credentials were correct and the session is live.
        // Throwing here left the user authenticated but stranded on the login
        // form with "contact your administrator", which also made
        // WorkspaceGuard's no-workspace screen — the one place an invite code
        // can be redeemed — impossible to reach by signing in. Send them to the
        // dashboard and let the guard present the options.
        router.push('/dashboard');
        return;
      }

      router.push(destination);
    } catch (error) {
      // A refused sign-in — wrong password, too many attempts — is the form's to
      // explain, not a fault. Logged as an error, every typo put Next's dev
      // overlay over the very form that was explaining it.
      if (!(error instanceof ApiError && error.code >= 400 && error.code < 500)) {
        logger.error('Login error', { error });
      }
      throw error;
    }
  };

  /**
   * Sign out HERE, whatever the server says.
   *
   * The local half used to run only after the request succeeded, and the request
   * failed with a 401 whenever the access token had lapsed — so for anyone idle
   * a quarter of an hour, "Log out" closed the menu and did nothing. The server
   * call is best effort; ending the session on this device is not.
   *
   * The query cache goes too: several queries are not keyed by user, and the
   * next person to sign in on this tab was shown the last person's answers
   * until they went stale. So does the realtime socket, and every other tab is
   * told (session-events) so that it does the same.
   */
  const logout = async () => {
    try {
      await authClient.logout();
    } catch (error) {
      logger.error('Logout error', { error });
    } finally {
      closeRealtime();
      announceSignedOut();
      queryClient.clear();
      setSignedOut(true);
      setUser(null);
      setSession(null);
      router.push('/login');
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };
  return (
    <AuthContext.Provider
      value={{ user, session, loading, backendUnreachable, signedOut, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
