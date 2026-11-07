'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceGuard } from '@/components/guards/workspace-guard';
import { TempPasswordGuard } from '@/components/guards/temp-password-guard';
import { CommandPalette } from '@/components/search/command-palette';
import { WorkspaceProvider } from '@/components/providers/workspace-provider';
import { PageContainer } from '@/components/layout/page-container';
import { SidebarProvider, useSidebar } from '@/components/layout/sidebar-context';
import { PageLoader } from '@/components/ui/page-loader';
import { ErrorState } from '@/components/ui/error-state';
import { cn } from '@/lib/utils';
import { useMyAccessRealtime } from '@/hooks/use-realtime';
import { loginPathReturningTo } from '@/lib/api/return-path';

function DashboardShell({
  isOnboarding,
  children,
}: {
  isOnboarding: boolean;
  children: React.ReactNode;
}) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  // A change to the caller's role, or to what their role may do, reaches the
  // screen they are on — whichever screen that is.
  useMyAccessRealtime();

  return (
    <div className="flex min-h-screen bg-background">
      {/* Keyboard users otherwise tab through ~20 sidebar links on every page
          load before reaching the content. Visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Global Command Palette (Cmd+K) */}
      <CommandPalette />

      {/* Sidebar - hide on onboarding */}
      {!isOnboarding && (
        <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:block">
          <Sidebar />
        </aside>
      )}

      {/* Main Content — offset matches the sidebar width from context */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-(--duration-layout)',
          !isOnboarding && (collapsed ? 'md:pl-16' : 'md:pl-64')
        )}
      >
        {!isOnboarding && <Header />}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
          {isOnboarding ? (
            <div className="px-4 py-5 sm:px-6 lg:px-8">{children}</div>
          ) : (
            // Keyed by pathname so the entrance animation replays on every
            // client-side navigation, not just the initial layout mount.
            <PageContainer key={pathname}>{children}</PageContainer>
          )}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, backendUnreachable, signedOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Only a real "not signed in" sends you to /login. If the API could not be
    // reached the session is unknown, not invalid — bouncing to a login form
    // that will also fail just hides the actual problem.
    //
    // Carrying the page along (`?next=`), so signing in returns there rather
    // than to the dashboard — unless the session was ended on purpose. Read
    // from `window` rather than useSearchParams, which would need a Suspense
    // boundary around the whole shell.
    if (!loading && !user && !backendUnreachable) {
      router.push(
        signedOut
          ? '/login'
          : loginPathReturningTo(`${window.location.pathname}${window.location.search}`)
      );
    }
  }, [user, loading, backendUnreachable, signedOut, router]);

  if (loading) {
    return <PageLoader className="h-screen" />;
  }

  if (!user && backendUnreachable) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          className="max-w-md"
          title="Can't reach the server"
          description="You are still signed in — the application server is not responding. This is not a login problem."
          retryLabel="Retry"
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // /onboarding is the one route that must skip the MEMBERSHIP check — it is
  // where a user with no workspace is sent to create one. It must NOT skip the
  // temporary-password gate: the API refuses POST /workspaces for such a
  // session, so an admin who still holds a mailed password was handed the
  // "Create Your Workspace" form and a 403 toast on submit, with no way out.
  const isOnboarding = pathname === '/onboarding';

  const content = (
    <WorkspaceProvider>
      <SidebarProvider>
        <TooltipProvider>
          <DashboardShell isOnboarding={isOnboarding}>{children}</DashboardShell>
        </TooltipProvider>
      </SidebarProvider>
    </WorkspaceProvider>
  );

  // Wrap with WorkspaceGuard unless it's the onboarding page — which still gets
  // the temporary-password half of it (see above).
  if (isOnboarding) {
    return <TempPasswordGuard>{content}</TempPasswordGuard>;
  }

  return <WorkspaceGuard>{content}</WorkspaceGuard>;
}
