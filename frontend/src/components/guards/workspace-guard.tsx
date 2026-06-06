'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useWorkspaces } from '@/hooks/use-workspace';
import { PageLoader } from '@/components/ui/page-loader';

export function WorkspaceGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { data: workspaces, isLoading: workspacesLoading } = useWorkspaces(user?.id);

  useEffect(() => {
    if (!authLoading && !workspacesLoading) {
      if (user && (!workspaces || workspaces.length === 0)) {
        router.push('/onboarding');
      }
    }
  }, [user, workspaces, authLoading, workspacesLoading, router]);

  if (authLoading || workspacesLoading) {
    return <PageLoader />;
  }

  // If no workspaces, don&apos;t render children (redirect will happen)
  if (!workspaces || workspaces.length === 0) {
    return null;
  }

  return <>{children}</>;
}
