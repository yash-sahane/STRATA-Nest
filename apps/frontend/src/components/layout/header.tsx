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
import { navigation } from '@/components/layout/sidebar';
import { useTeamMembers, ROLE_CONFIG } from '@/hooks/use-team';
import { cn, getInitials } from '@/lib/utils';

export function Header() {
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

  // Add to history when results are found
  React.useEffect(() => {
    if (debouncedQuery.trim() && results.length > 0) {
      addToHistory(debouncedQuery, results.length);
    }
  }, [debouncedQuery, results.length, addToHistory]);

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
    setIsSearchOpen(false);
    setSearchQuery('');

    // Navigate based on type
    switch (result.type) {
      case 'task':
        router.push(`/tasks?taskId=${result.id}`);
        break;
      case 'project':
        router.push(`/projects/${result.id}`);
        break;
      case 'epic':
        router.push(`/epics?epicId=${result.id}`);
        break;
      case 'sprint':
        // /sprints/[id] has no page of its own — only /board, /backlog, /analytics.
        router.push(`/sprints/${result.id}/board`);
        break;
      case 'requirement':
        // The 'requirement' corpus is functional_requirements (use-global-search),
        // so the id belongs to /functional-requirements — `reqId` was read by no page.
        router.push(`/functional-requirements?frId=${result.id}`);
        break;
    }
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
        return FileText;
      default:
        return Search;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'task':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
      case 'project':
        return 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
      case 'epic':
        return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
      case 'sprint':
        return 'bg-green-500/10 text-green-600 dark:text-green-400';
      case 'requirement':
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
          <DropdownMenuLabel>Navigation</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            return (
              <DropdownMenuItem
                key={item.href}
                onClick={() => router.push(item.href)}
                className={cn('cursor-pointer', isActive && 'bg-accent text-accent-foreground')}
              >
                <Icon className="mr-2 h-4 w-4" />
                {item.name}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Search */}
      <div className="flex-1 relative">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="search"
            placeholder="Search tasks, projects, requirements..."
            className="w-full pl-9 pr-9"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsSearchOpen(true);
            }}
            onFocus={() => setIsSearchOpen(true)}
          />
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
        {isSearchOpen && (searchQuery || results.length > 0) && (
          <Card
            ref={searchDropdownRef}
            className="absolute top-full left-0 mt-2 w-full max-w-2xl shadow-lg border z-50"
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

              {!isLoading && searchQuery && results.length === 0 && (
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
                      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground capitalize">
                        {type}s ({items.length})
                      </div>
                      {items.slice(0, 5).map((result) => {
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
                            aria-label={`Open ${result.type}: ${result.title}`}
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
                                    {result.status.replace('_', ' ')}
                                  </Badge>
                                )}
                                {result.priority && (
                                  <Badge variant="outline" className="text-xs">
                                    {result.priority}
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
                      {items.length > 5 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                          +{items.length - 5} more {type}s
                        </div>
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
                    {ROLE_CONFIG[currentMember.role].label}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* /profile is a read-only summary; all editing lives in Settings →
                Profile, so the label says so rather than implying a second editor. */}
            <DropdownMenuItem onClick={() => router.push('/profile')} className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              View profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-destructive-text">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
