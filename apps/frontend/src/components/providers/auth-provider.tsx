'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/api/client';
import { ApiError } from '@/lib/api/rest-client';
import { User } from '@/types';
import { usePathname, useRouter } from 'next/navigation';
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
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * The routes a visitor is expected to reach while signed out. Asking `auth/me`
 * here is a question whose answer is already known — it 401s every time, and
 * the browser prints "Failed to load resource: 401" for a failed request no
 * matter how gracefully the app handles the rejection. So the very first screen
 * anyone sees came with a burst of red console errors describing the normal
 * path. Nothing rendered on these routes reads `user`, so nothing is lost by
 * not asking.
 *
 * `/change-password` is deliberately absent: it sits in the same route group
 * but is an authenticated screen (the forced temporary-password change), and it
 * does read `user`.
 */
const PUBLIC_AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password'];

const isPublicAuthRoute = (pathname: string | null): boolean =>
  !!pathname && PUBLIC_AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<ApiModels.Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // Whether the session has been asked about at all yet. A ref, not state,
  // because it must gate the effect without re-running it.
  const probedRef = useRef(false);

  // The `/api/v1/auth/me/` endpoint returns the profile, session, and workspace
  // membership fields used by the app in a single round-trip.
  const loadUser = async (): Promise<any | null> => {
    try {
      const currentSession = await authClient.getCurrentSession();
      setSession(currentSession);

      const currentUser: any = await authClient.getCurrentUser();
      const now = new Date().toISOString();
      const userData: User = {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        phone: currentUser.phone,
        avatar: currentUser.avatar,
        role: currentUser.role || 'SOFTWARE_DEVELOPER',
        workspaceId: currentUser.workspaceId || '',
        defaultWorkspaceId: currentUser.defaultWorkspaceId || currentUser.workspaceId || '',
        workspaceIds: Array.isArray(currentUser.workspaceIds) ? currentUser.workspaceIds : [],
        hasTempPassword: currentUser.hasTempPassword === true,
        isAdmin: currentUser.isAdmin === true,
        status: currentUser.status || 'ACTIVE',
        createdAt: currentUser.createdAt || now,
        updatedAt: currentUser.updatedAt || now,
      };
      setUser(userData);
      setBackendUnreachable(false);
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

  const login = async (email: string, password: string) => {
    try {
      await authClient.login(email, password);
      const currentUser = await loadUser();

      if (!currentUser) {
        router.push('/dashboard');
        return;
      }

      if (currentUser.hasTempPassword === true) {
        router.push('/change-password?forced=true');
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

      router.push('/dashboard');
    } catch (error) {
      logger.error('Login error', { error });
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authClient.logout();
      setUser(null);
      setSession(null);
      router.push('/login');
    } catch (error) {
      logger.error('Logout error', { error });
      throw error;
    }
  };

  const refreshUser = async () => {
    await loadUser();
  };
  return (
    <AuthContext.Provider value={{ user, session, loading, backendUnreachable, login, logout, refreshUser }}>
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
