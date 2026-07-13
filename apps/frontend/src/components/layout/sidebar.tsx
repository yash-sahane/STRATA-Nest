'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Users,
  Calendar,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Clock,
  Target,
  List,
  Activity,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/providers/auth-provider';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';

interface SidebarProps {
  className?: string;
}

export const navigation = [
  // Overview Section
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    description: 'Overview and analytics',
  },
  {
    name: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    description: 'Reports and insights',
  },
  {
    name: 'Activity',
    href: '/activity',
    icon: Activity,
    description: 'Recent project activities',
  },

  // Hierarchical Work Items (Follows proper flow)
  {
    name: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    description: 'Manage your projects',
  },
  {
    name: 'Requirements',
    href: '/requirements',
    icon: FileText,
    description: 'Client requirements',
  },
  {
    name: 'Epics',
    href: '/epics',
    icon: Target,
    description: 'Large features & initiatives',
  },
  {
    name: 'Functional Reqs',
    href: '/functional-requirements',
    icon: List,
    description: 'Technical specifications',
  },
  {
    name: 'Sprints',
    href: '/sprints',
    icon: GitBranch,
    description: 'Sprint planning & tracking',
  },
  {
    name: 'Tasks',
    href: '/tasks',
    icon: CheckSquare,
    description: 'View and manage tasks',
  },

  // Team & Time Management
  {
    name: 'Team',
    href: '/team',
    icon: Users,
    description: 'Team members & roles',
  },
  {
    name: 'Attendance',
    href: '/attendance',
    icon: Clock,
    description: 'Time tracking & leaves',
  },
  {
    name: 'Calendar',
    href: '/calendar',
    icon: Calendar,
    description: 'Events and deadlines',
  },

  // Configuration
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    description: 'Workspace settings',
  },
];

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = React.useState(false);

  // Load collapsed state from localStorage
  React.useEffect(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    if (stored) {
      setCollapsed(stored === 'true');
    }
  }, []);

  // Save collapsed state and update body class for layout adjustment
  const toggleCollapsed = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', String(newState));

    // Update CSS variable for main content padding
    if (newState) {
      document.documentElement.style.setProperty('--sidebar-width', '4rem');
    } else {
      document.documentElement.style.setProperty('--sidebar-width', '16rem');
    }
  };

  // Set initial CSS variable
  React.useEffect(() => {
    if (collapsed) {
      document.documentElement.style.setProperty('--sidebar-width', '4rem');
    } else {
      document.documentElement.style.setProperty('--sidebar-width', '16rem');
    }
  }, [collapsed]);

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'relative flex h-screen flex-col border-r bg-background transition-all duration-300',
          collapsed ? 'w-16' : 'w-64',
          className
        )}
      >
        {/* Logo */}
        <div className="flex h-16 shrink-0 items-center border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold">
            {collapsed ? (
              <div className="flex h-8 w-8 items-center justify-center">
                <img
                  src="/logo.svg"
                  alt="PC"
                  className="h-8 w-8 dark:invert dark:brightness-0 dark:contrast-200"
                />
              </div>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center">
                  <img
                    src="/logo.svg"
                    alt="STRATA"
                    className="h-10 w-10 dark:invert dark:brightness-0 dark:contrast-200"
                  />
                </div>
                <span className="text-lg font-semibold">STRATA</span>
              </>
            )}
          </Link>
        </div>

        {/* Workspace Switcher */}
        {!collapsed && (
          <div className="shrink-0 border-b p-4">
            <WorkspaceSwitcher />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;

            const linkContent = (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:bg-accent',
                  isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                  collapsed && 'justify-center'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return linkContent;
          })}
        </nav>

        {/* User Info */}
        {!collapsed && user && (
          <>
            <Separator />
            <div className="shrink-0 p-4">
              <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground font-semibold shadow-md ring-2 ring-background">
                  {user.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-sm font-semibold">{user.name || 'User'}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Collapse Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-3 top-20 z-10 h-6 w-6 rounded-full border bg-background shadow-md"
          onClick={toggleCollapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </TooltipProvider>
  );
}
