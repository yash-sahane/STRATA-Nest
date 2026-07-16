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
  CalendarOff,
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
  Building2,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/components/providers/auth-provider';
import { useSidebar } from '@/components/layout/sidebar-context';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';

interface SidebarProps {
  className?: string;
}

export interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Visual navigation groups. Sections carry meaning (the hierarchical Work flow,
 * Team & Time, etc.), so they render as labelled groups rather than one flat
 * list. Add destinations here — the flat `navigation` export is derived from it.
 */
export const navigationGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, description: 'Overview and analytics' },
      { name: 'Analytics', href: '/analytics', icon: BarChart3, description: 'Reports and insights' },
      { name: 'Activity', href: '/activity', icon: Activity, description: 'Recent project activities' },
    ],
  },
  {
    label: 'Work',
    items: [
      { name: 'Projects', href: '/projects', icon: FolderKanban, description: 'Manage your projects' },
      { name: 'Requirements', href: '/requirements', icon: FileText, description: 'Client requirements' },
      { name: 'Epics', href: '/epics', icon: Target, description: 'Large features & initiatives' },
      { name: 'Functional Reqs', href: '/functional-requirements', icon: List, description: 'Technical specifications' },
      { name: 'Sprints', href: '/sprints', icon: GitBranch, description: 'Sprint planning & tracking' },
      { name: 'Tasks', href: '/tasks', icon: CheckSquare, description: 'View and manage tasks' },
    ],
  },
  {
    label: 'Team & Time',
    items: [
      { name: 'Team', href: '/team', icon: Users, description: 'Team members & roles' },
      { name: 'Attendance', href: '/attendance', icon: Clock, description: 'Check-in & time tracking' },
      { name: 'Leave', href: '/leave', icon: CalendarOff, description: 'Leave requests & balances' },
      { name: 'Calendar', href: '/calendar', icon: Calendar, description: 'Events and deadlines' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { name: 'Workspaces', href: '/workspaces', icon: Building2, description: 'Switch or manage workspaces' },
      { name: 'Settings', href: '/settings', icon: Settings, description: 'Workspace settings' },
    ],
  },
];

/** Flat list of every destination — consumed by the header search/nav. */
export const navigation: NavItem[] = navigationGroups.flatMap((group) => group.items);

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { collapsed, toggle } = useSidebar();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
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
          <div className={cn('flex items-center justify-center', collapsed ? 'h-8 w-8' : 'h-10 w-10')}>
            <img
              src="/logo.svg"
              alt="STRATA"
              className={cn(collapsed ? 'h-8 w-8' : 'h-10 w-10', 'dark:invert dark:brightness-0 dark:contrast-200')}
            />
          </div>
          {!collapsed && <span className="text-lg font-semibold">STRATA</span>}
        </Link>
      </div>

      {/* Workspace Switcher */}
      {!collapsed && (
        <div className="shrink-0 border-b p-4">
          <WorkspaceSwitcher />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700">
        {navigationGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              const link = (
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
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
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return <React.Fragment key={item.name}>{link}</React.Fragment>;
            })}
          </div>
        ))}
      </nav>

      {/* User Info */}
      {!collapsed && user && (
        <>
          <Separator />
          <div className="shrink-0 p-4">
            <div className="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent/50">
              <Avatar className="h-10 w-10 shadow-md ring-2 ring-background">
                <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 font-semibold text-primary-foreground">
                  {getInitials(user.name || 'User')}
                </AvatarFallback>
              </Avatar>
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
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>
    </div>
  );
}
