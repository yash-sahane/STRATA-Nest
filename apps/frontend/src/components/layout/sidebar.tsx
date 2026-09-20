'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Timer,
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
import { useNavigationPermissions } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';

interface SidebarProps {
  className?: string;
}

export interface NavItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  description: string;
  /**
   * Permission required to see this destination at all. Omitted means "always"
   * (Dashboard, Settings — every member has somewhere to land and somewhere to
   * change their own profile).
   *
   * Navigation used to be identical for every role, so gating happened only
   * AFTER the page loaded and rendered its own denial — the user was invited
   * into a room and turned away at the door. These are the same VIEW_*
   * permissions the destination pages themselves check.
   */
  permission?: Permission;
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
      { name: 'Analytics', href: '/analytics', icon: BarChart3, description: 'Reports and insights', permission: Permission.VIEW_ANALYTICS },
      { name: 'Activity', href: '/activity', icon: Activity, description: 'Recent workspace activity', permission: Permission.VIEW_WORKSPACE },
    ],
  },
  {
    label: 'Work',
    items: [
      { name: 'Projects', href: '/projects', icon: FolderKanban, description: 'Manage your projects', permission: Permission.VIEW_PROJECTS },
      { name: 'Requirements', href: '/requirements', icon: FileText, description: 'Client requirements', permission: Permission.VIEW_REQUIREMENTS },
      { name: 'Epics', href: '/epics', icon: Target, description: 'Large features & initiatives', permission: Permission.VIEW_EPICS },
      { name: 'Functional Reqs', href: '/functional-requirements', icon: List, description: 'Technical specifications', permission: Permission.VIEW_FUNCTIONAL_REQUIREMENTS },
      { name: 'Sprints', href: '/sprints', icon: GitBranch, description: 'Sprint planning & tracking', permission: Permission.VIEW_SPRINTS },
      { name: 'Tasks', href: '/tasks', icon: CheckSquare, description: 'View and manage tasks', permission: Permission.VIEW_TASKS },
    ],
  },
  {
    label: 'Team & Time',
    items: [
      { name: 'Team', href: '/team', icon: Users, description: 'Team members & roles', permission: Permission.VIEW_TEAM },
      { name: 'Attendance', href: '/attendance', icon: Clock, description: 'Check-in & time tracking', permission: Permission.VIEW_TEAM },
      // No permission gate: logging your own time is part of the member
      // baseline (hr:write). The Approvals tab inside is gated separately.
      { name: 'Time Tracking', href: '/time-tracking', icon: Timer, description: 'Timesheet & approvals' },
      { name: 'Leave', href: '/leave', icon: CalendarOff, description: 'Leave requests & balances', permission: Permission.REQUEST_LEAVE },
      { name: 'Calendar', href: '/calendar', icon: Calendar, description: 'Events and deadlines', permission: Permission.VIEW_TASKS },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { name: 'Workspaces', href: '/workspaces', icon: Building2, description: 'Switch or manage workspaces', permission: Permission.VIEW_WORKSPACE },
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
  const { permissions, isLoading: permissionsLoading } = useNavigationPermissions();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  /**
   * Filter, then drop groups the filter emptied.
   *
   * Fails OPEN while the membership request is in flight: `permissions` is empty
   * until it resolves, so filtering eagerly would render an almost-blank sidebar
   * on every cold load and then pop the real one in. A link the user cannot use
   * for a few hundred milliseconds is a far smaller harm than navigation that
   * flickers — and the destination page enforces its own access regardless.
   */
  const visibleGroups = React.useMemo(() => {
    if (permissionsLoading) return navigationGroups;
    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || permissions.has(item.permission)),
      }))
      .filter((group) => group.items.length > 0);
  }, [permissions, permissionsLoading]);

  return (
    <div
      className={cn(
        'relative flex h-screen flex-col border-r bg-background transition-[width] duration-(--duration-layout)',
        collapsed ? 'w-16' : 'w-64',
        className
      )}
    >
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center border-b px-4">
        {/* `hover:opacity-80` because this link had NO hover response of any kind —
            measured by screenshotting it hovered and not, and comparing: zero pixels
            changed. It is the only way back to the dashboard from the top of the
            sidebar, and nothing told anyone it was a link. Opacity rather than a colour,
            because the mark is an image in light theme and an inverted one in dark, and
            opacity is the one treatment that reads the same on both. */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-bold transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
        >
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
        {visibleGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              const link = (
                <Link
                  href={item.href}
                  // The page you are on, said out loud. Nothing in this app used
                  // `aria-current` anywhere: sighted users got `bg-accent` and everybody
                  // else got no indication at all of which of the eighteen links they
                  // were currently looking at.
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    // The active item needs its OWN hover: `hover:bg-accent` on top of
                    // `bg-accent` is the same colour, so hovering the current page's link
                    // changed not one pixel — measured — while every other link in the
                    // same list responded.
                    active
                      ? 'bg-accent text-accent-foreground hover:bg-accent/70'
                      : 'text-muted-foreground hover:bg-accent',
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
            {/* Static identity block — the account menu lives in the header, so
                this must not look clickable. */}
            <div className="flex items-center gap-3 rounded-lg p-2">
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
