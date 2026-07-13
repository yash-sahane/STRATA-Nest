'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { authClient } from '@/lib/api/client';
import { User } from '@/types';
import { useRouter } from 'next/navigation';
import type { ApiModels } from '@/lib/api/client';
import { logger } from '@/lib/logger';

interface AuthContextType {
  user: User | null;
  session: ApiModels.Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<ApiModels.Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

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
      return currentUser;
    } catch (error) {
      setUser(null);
      setSession(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

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
        throw new Error(
          'Your account is not associated with any workspace. Please contact your administrator.'
        );
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
    <AuthContext.Provider value={{ user, session, loading, login, logout, refreshUser }}>
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
