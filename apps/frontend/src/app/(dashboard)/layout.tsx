'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceGuard } from '@/components/guards/workspace-guard';
import { CommandPalette } from '@/components/search/command-palette';
import { WorkspaceProvider } from '@/components/providers/workspace-provider';
import { DeadlineReminderChecker } from '@/components/notifications/deadline-reminder-checker';
import { PageContainer } from '@/components/layout/page-container';
import { SidebarProvider, useSidebar } from '@/components/layout/sidebar-context';
import { PageLoader } from '@/components/ui/page-loader';
import { cn } from '@/lib/utils';

function DashboardShell({
  isOnboarding,
  children,
}: {
  isOnboarding: boolean;
  children: React.ReactNode;
}) {
  const { collapsed } = useSidebar();

  return (
    <div className="flex min-h-screen bg-background">
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
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-300',
          !isOnboarding && (collapsed ? 'md:pl-16' : 'md:pl-64')
        )}
      >
        {!isOnboarding && <Header />}
        <main className="flex-1 overflow-y-auto">
          {isOnboarding ? (
            <div className="px-4 py-5 sm:px-6 lg:px-8">{children}</div>
          ) : (
            <PageContainer>{children}</PageContainer>
          )}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return <PageLoader className="h-screen" />;
  }

  if (!user) {
    return null;
  }

  // Don't apply WorkspaceGuard to the onboarding page.
  const isOnboarding = pathname === '/onboarding';

  const content = (
    <WorkspaceProvider>
      <SidebarProvider>
        <TooltipProvider>
          {/* Background deadline reminder checker */}
          <DeadlineReminderChecker />
          <DashboardShell isOnboarding={isOnboarding}>{children}</DashboardShell>
        </TooltipProvider>
      </SidebarProvider>
    </WorkspaceProvider>
  );

  // Wrap with WorkspaceGuard unless it's the onboarding page.
  if (isOnboarding) {
    return content;
  }

  return <WorkspaceGuard>{content}</WorkspaceGuard>;
}
