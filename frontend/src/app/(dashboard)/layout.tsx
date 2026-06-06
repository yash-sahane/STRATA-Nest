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
import { cn } from '@/lib/utils';

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
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Don't apply WorkspaceGuard to onboarding page
  const isOnboarding = pathname === '/onboarding';

  const content = (
    <WorkspaceProvider>
      <TooltipProvider>
        {/* Background deadline reminder checker */}
        <DeadlineReminderChecker />

        <div className="flex min-h-screen bg-background">
          {/* Global Command Palette (Cmd+K) */}
          <CommandPalette />

          {/* Sidebar - hide on onboarding */}
          {!isOnboarding && (
            <aside className="hidden md:block md:fixed md:inset-y-0 md:left-0 md:z-30">
              <Sidebar />
            </aside>
          )}

          {/* Main Content */}
          <div
            className={cn(
              'flex min-w-0 flex-1 flex-col transition-[padding] duration-300',
              !isOnboarding && 'md:pl-[var(--sidebar-width,16rem)]'
            )}
          >
            {!isOnboarding && <Header />}
            <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </TooltipProvider>
    </WorkspaceProvider>
  );

  // Wrap with WorkspaceGuard unless it's the onboarding page
  if (isOnboarding) {
    return content;
  }

  return <WorkspaceGuard>{content}</WorkspaceGuard>;
}
