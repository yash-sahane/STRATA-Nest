'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search,
  Menu,
  Moon,
  Sun,
  LogOut,
  User,
  Settings,
  CheckSquare,
  FolderKanban,
  Target,
  Zap,
  FileText,
  Loader2,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/components/providers/auth-provider';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useGlobalSearch, type SearchResult } from '@/hooks/use-global-search';
import { SearchHighlight } from '@/components/search/search-highlight';
import { useSearchHistory, TopSearches } from '@/components/search/search-history';
import { useVisibleNavigation } from '@/components/layout/sidebar';
import Link from 'next/link';
import { OPEN_COMMAND_PALETTE, useModKey } from '@/hooks/use-mod-key';
import { getPriorityConfig } from '@/lib/semantic/priority';
import { useTeamMembers } from '@/hooks/use-team';
import { roleDisplayName } from '@/hooks/use-role-options';
import { searchResultUrl, searchTypeLabel } from '@/lib/search-result-url';
import { cn, getInitials } from '@/lib/utils';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';
import { useSidebar } from '@/components/layout/sidebar-context';
import { humanizeEnum } from '@/lib/semantic/status';
import { RunningTimerChip } from '@/components/time-tracking/running-timer-chip';

export function Header() {
  const { collapsed } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const [mounted, setMounted] = React.useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchDropdownRef = React.useRef<HTMLDivElement>(null);

  // Get workspace for search
  const { currentWorkspace } = useCurrentWorkspace();

  // Get team members to find current user's workspace role
  const { data: teamMembers = [] } = useTeamMembers(currentWorkspace?.id);

  // Find current user's workspace member record
  const currentMember = React.useMemo(() => {
    if (!user || !teamMembers.length) return null;
    return teamMembers.find((member) => member.userId === user.id);
  }, [user, teamMembers]);

  // Search functionality
  const { data: results = [], isLoading } = useGlobalSearch(debouncedQuery, currentWorkspace?.id);

  const { addToHistory } = useSearchHistory();
  const { items: navigation } = useVisibleNavigation();
  const modKey = useModKey();
  // Groups of results shown in full ("+3 more" opened).
  const [expandedTypes, setExpandedTypes] = React.useState<ReadonlySet<string>>(new Set());
  React.useEffect(() => setExpandedTypes(new Set()), [debouncedQuery]);

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Debounce search query
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);


  // Handle click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const handleResultClick = (result: SearchResult) => {
    // Remembered when a search led somewhere — not at every pause in typing,
    // which filled "Recent searches" with "ta", "tas", "task".
    addToHistory(searchQuery, results.length);
    setIsSearchOpen(false);
    setSearchQuery('');

    router.push(searchResultUrl(result));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'task':
        return CheckSquare;
      case 'project':
        return FolderKanban;
      case 'epic':
        return Target;
      case 'sprint':
        return Zap;
      case 'requirement':
      case 'client-requirement':
        return FileText;
      default:
        return Search;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'task':
        return 'bg-blue-500/10 text-info-text';
      case 'project':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
      case 'epic':
        return 'bg-orange-500/10 text-warning-text';
      case 'sprint':
        return 'bg-green-500/10 text-success-text';
      case 'requirement':
      case 'client-requirement':
        return 'bg-pink-500/10 text-pink-600 dark:text-pink-400';
      default:
        return 'bg-gray-500/10 text-gray-600 dark:text-gray-400';
    }
  };

  // Group results by type
  const groupedResults = React.useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    results.forEach((result) => {
      if (!groups[result.type]) {
        groups[result.type] = [];
      }
      groups[result.type].push(result);
    });
    return groups;
  }, [results]);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden">
            <Menu className="h-4 w-4" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* Which workspace this is, and the way to change it — the phone's
              stand-in for the switcher the bar has no room for. */}
          {currentWorkspace && (
            <>
              <DropdownMenuLabel className="sm:hidden">
                <span className="block text-xs font-normal text-muted-foreground">Workspace</span>
                <span className="block truncate" title={currentWorkspace.name}>{currentWorkspace.name}</span>
              </DropdownMenuLabel>
              <DropdownMenuItem className="sm:hidden" asChild>
                <Link href="/workspaces">Switch workspace</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="sm:hidden" />
            </>
          )}
          <DropdownMenuLabel>Navigation</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            return (
              <DropdownMenuItem
                key={item.href}
                asChild
                className={cn(isActive && 'bg-accent text-accent-foreground')}
              >
                {/* A link, so it opens in a new tab like any other: the sidebar's
                    are, and these said the same pages. Same as the sidebar too:
                    say which page this is, for anyone who cannot see that it is
                    the highlighted one. */}
                <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
                  <Icon className="mr-2 h-4 w-4" />
                  {item.name}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Which workspace this is, wherever the sidebar is not saying so.

          The switcher lives in the sidebar, and the sidebar is hidden below `md`
          and drops the switcher when collapsed — so on a phone, or with the
          sidebar folded, nothing on screen named the workspace whose data was
          being shown, and the only way to change it was a trip to the
          Workspaces page. Hidden again exactly where the sidebar shows its
          own, so there are never two.

          From `sm` up only. At phone width the bar already holds five controls,
          and a sixth overlapped its neighbour (measured at 320px); there the
          navigation menu names the workspace and offers the switch instead. */}
      <div className={cn('hidden min-w-0 shrink sm:block', !collapsed && 'md:hidden')}>
        <WorkspaceSwitcher className="w-auto max-w-[14rem]" />
      </div>

      {/* Search */}
      <div className="flex-1 relative">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder="Search tasks, projects, requirements..."
            className="w-full pl-9 pr-9 sm:pr-16"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsSearchOpen(true);
            }}
            onFocus={() => setIsSearchOpen(true)}
          />
          {/* The way to the command palette, which only a shortcut nothing
              mentioned used to open. */}
          {!searchQuery && (
            <button
              type="button"
              aria-label="Open the command palette"
              title="Commands and quick actions"
              onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
              className="absolute right-2 top-1/2 hidden h-6 -translate-y-1/2 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            >
              {modKey} K
            </button>
          )}
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              onClick={() => {
                setSearchQuery('');
                setIsSearchOpen(false);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Search Results Dropdown */}
        {/* Open on focus, query or not: with an empty box it is where the
            recent searches are — which never showed while the dropdown waited
            for a query. As wide as the screen on a phone, where the box itself
            is a third of it. */}
        {isSearchOpen && (
          <Card
            ref={searchDropdownRef}
            className="fixed inset-x-2 top-16 z-50 border shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-full sm:max-w-2xl"
          >
            <ScrollArea className="max-h-[500px]">
              {!searchQuery && !isLoading && (
                <div className="p-4">
                  <TopSearches
                    onSelect={(query) => {
                      setSearchQuery(query);
                      setIsSearchOpen(true);
                    }}
                  />
                  <div className="mt-4 text-center text-sm text-muted-foreground">
                    Start typing to search across all your tasks, projects, and more...
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Searching...</span>
                </div>
              )}

              {searchQuery.trim().length === 1 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Keep typing — search starts at two characters.
                </p>
              )}

              {!isLoading && searchQuery.trim().length >= 2 && results.length === 0 && (
                <div className="p-8 text-center">
                  <Search className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-sm font-semibold">No results found</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try searching with different keywords
                  </p>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <div className="p-2">
                  <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                    Found {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
                  </div>

                  {Object.entries(groupedResults).map(([type, items]) => (
                    <div key={type}>
                      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                        {searchTypeLabel(type, true)} ({items.length})
                      </div>
                      {(expandedTypes.has(type) ? items : items.slice(0, 5)).map((result) => {
                        const Icon = getIcon(result.type);
                        return (
                          <div
                            key={result.id}
                            /* A bare <div onClick> was unreachable: Tab went
                               from the clear button straight out of the
                               dropdown, and Enter did nothing — so the search
                               box accepted keyboard input, showed results, and
                               then offered no keyboard way to act on any of
                               them. Not a <button>: the row carries a Badge and
                               nested interactives are what the drag-handle
                               split elsewhere exists to avoid. */
                            role="button"
                            tabIndex={0}
                            aria-label={`Open ${searchTypeLabel(result.type).toLowerCase()}: ${result.title}`}
                            className="flex items-start gap-3 rounded-lg p-3 hover:bg-accent cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                            onClick={() => handleResultClick(result)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleResultClick(result);
                              }
                            }}
                          >
                            <div className={`rounded-md p-2 ${getTypeColor(result.type)}`}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium line-clamp-1">
                                  <SearchHighlight text={result.title} query={searchQuery} />
                                </h4>
                                {result.hierarchyId && (
                                  <Badge variant="outline" className="text-xs">
                                    {result.hierarchyId}
                                  </Badge>
                                )}
                              </div>
                              {result.description && (
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  <SearchHighlight text={result.description} query={searchQuery} />
                                </p>
                              )}
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {result.status && (
                                  <Badge variant="secondary" className="text-xs">
                                    {humanizeEnum(result.status)}
                                  </Badge>
                                )}
                                {result.priority && (
                                  <Badge variant="outline" className="text-xs">
                                    {getPriorityConfig(result.priority).label}
                                  </Badge>
                                )}
                                {/* matchStrength, not relevanceScore: the latter
                                    is a sum over fields times a per-type boost
                                    and reached "Match: 270%". */}
                                {result.matchStrength > 0 && (
                                  <span className="ml-auto">
                                    Match: {Math.round(result.matchStrength)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {items.length > 5 && !expandedTypes.has(type) && (
                        // Was "+3 more tasks" as dead text — and "+2 more
                        // functional_requirements", from the raw key.
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs text-muted-foreground"
                          onClick={() => setExpandedTypes((open) => new Set(open).add(type))}
                        >
                          Show {items.length - 5} more {searchTypeLabel(type, true).toLowerCase()}
                        </Button>
                      )}
                      <Separator className="my-2" />
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </Card>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* A running timer, from every page — see RunningTimerChip. From `md`
            up: below that the bar has no room for another control (measured
            at 320px), and the timer is one tap away on the task it belongs to. */}
        <RunningTimerChip userId={user?.id} className="hidden md:flex" />

        {/* Theme Toggle */}
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9"
            // The icon shows what you would GET, which tells a sighted user the
            // direction and a screen-reader user nothing at all — "Toggle theme"
            // named neither the current theme nor the destination.
            aria-label={
              theme === 'dark' ? 'Switch to light theme (currently dark)' : 'Switch to dark theme (currently light)'
            }
            title={theme === 'dark' ? 'Currently dark' : 'Currently light'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        )}

        {/* Notifications */}
        {/* Mounted only once the user id is known.
            Rendering it earlier made its queries start with `enabled: false` and
            flip to true in the same commit, and TanStack fetches twice across
            that transition — once from the observer subscribing, once from
            setOptions in useBaseQuery's effect. That was every header query
            firing twice on a full page load. */}
        {user?.id && <NotificationCenter />}

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.avatar} alt={user?.name || 'User'} />
                <AvatarFallback>{getInitials(user?.name || 'User')}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium md:inline-block">
                {user?.name || 'User'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name || 'User'}</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                {currentMember?.role && (
                  <Badge variant="outline" className="mt-1 w-fit text-xs">
                    {roleDisplayName(currentMember.rawRole)}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* /profile is a read-only summary; all editing lives in Settings →
                Profile, so the label says so rather than implying a second editor. */}
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" />
                View profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive-text">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
