'use client';

import * as React from 'react';
import { OPEN_COMMAND_PALETTE, useModKey } from '@/hooks/use-mod-key';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Search, FileText, FolderKanban, Target, Zap, Settings, CheckSquare } from 'lucide-react';
import { navigationGroups } from '@/components/layout/sidebar';
import { useGlobalSearch } from '@/hooks/use-global-search';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';
import { useNavigationPermissions } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { searchResultUrl, searchTypeLabel } from '@/lib/search-result-url';

type CommandAction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  group: string;
};

export function CommandPalette() {
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();

  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const { permissions, isLoading: permissionsLoading } = useNavigationPermissions();

  const { data: searchResults = [], isLoading } = useGlobalSearch(
    searchQuery,
    currentWorkspace?.id
  );

  const modKey = useModKey();

  // Keyboard shortcut (Cmd+K or Ctrl+K), and the header's button.
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    const ask = () => setOpen(true);

    document.addEventListener('keydown', down);
    window.addEventListener(OPEN_COMMAND_PALETTE, ask);
    return () => {
      document.removeEventListener('keydown', down);
      window.removeEventListener(OPEN_COMMAND_PALETTE, ask);
    };
  }, []);

  const go = React.useCallback(
    (href: string) => {
      router.push(href);
      setOpen(false);
    },
    [router]
  );

  /**
   * Navigation: the sidebar's own list, filtered the way the sidebar filters it.
   *
   * This used to be a second, hand-written list — eleven destinations to the
   * sidebar's sixteen, so Attendance, Leave, Time Tracking, Functional
   * Requirements and Workspaces could not be reached from here at all, two of
   * the rest were named differently from the page they opened, and none of it
   * looked at what the caller's role may see.
   */
  const navigationActions: CommandAction[] = navigationGroups
    .flatMap((group) => group.items)
    .filter(
      (item) => permissionsLoading || !item.permission || permissions.has(item.permission)
    )
    .map((item) => ({
      id: `nav-${item.href}`,
      label: item.name,
      icon: <item.icon className="h-4 w-4" />,
      onSelect: () => go(item.href),
      group: 'Go to',
    }));

  /**
   * Quick actions, offered only to somebody who may take them. Each opens the
   * page's own create dialog (`?action=create`); a role without the permission
   * used to be sent to a page that then ignored the request.
   */
  const quickActions: CommandAction[] = [
    {
      id: 'action-create-task',
      label: 'New Task',
      icon: <CheckSquare className="h-4 w-4" />,
      onSelect: () => go('/tasks?action=create'),
      group: 'Create',
      permission: Permission.CREATE_TASK,
    },
    {
      id: 'action-create-project',
      label: 'New Project',
      icon: <FolderKanban className="h-4 w-4" />,
      onSelect: () => go('/projects?action=create'),
      group: 'Create',
      permission: Permission.CREATE_PROJECT,
    },
    {
      id: 'action-create-epic',
      label: 'New Epic',
      icon: <Target className="h-4 w-4" />,
      onSelect: () => go('/epics?action=create'),
      group: 'Create',
      permission: Permission.CREATE_EPIC,
    },
    {
      id: 'action-create-sprint',
      label: 'New Sprint',
      icon: <Zap className="h-4 w-4" />,
      onSelect: () => go('/sprints?action=create'),
      group: 'Create',
      permission: Permission.CREATE_SPRINT,
    },
  ].filter((action) => !permissionsLoading && permissions.has(action.permission));

  // Each lands on the tab it names. "Workspace Settings" used to open the
  // Workspaces list, and "Profile Settings" whichever tab was open last.
  const settingsActions: CommandAction[] = [
    {
      id: 'settings-profile',
      label: 'Profile Settings',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => go('/settings?tab=profile'),
      group: 'Settings',
    },
    {
      id: 'settings-notifications',
      label: 'Notification Preferences',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => go('/settings?tab=notifications'),
      group: 'Settings',
    },
    ...(permissions.has(Permission.MANAGE_WORKSPACE_SETTINGS)
      ? [
          {
            id: 'settings-workspace',
            label: 'Workspace Settings',
            icon: <Settings className="h-4 w-4" />,
            onSelect: () => go('/settings?tab=workspace'),
            group: 'Settings',
          },
        ]
      : []),
  ];

  const allActions = [...navigationActions, ...quickActions, ...settingsActions];

  // Filter actions by search query
  const filteredActions = searchQuery
    ? allActions.filter((action) =>
      action.label.toLowerCase().includes(searchQuery.toLowerCase())
    )
    : allActions;

  // Group actions
  const groupedActions = React.useMemo(() => {
    const groups: Record<string, CommandAction[]> = {};
    filteredActions.forEach((action) => {
      if (!groups[action.group]) {
        groups[action.group] = [];
      }
      groups[action.group].push(action);
    });
    return groups;
  }, [filteredActions]);

  const hasAnything =
    searchResults.length > 0 || Object.keys(groupedActions).length > 0;

  const getResultIcon = (type: string) => {
    switch (type) {
      case 'task':
        return <CheckSquare className="h-4 w-4" />;
      case 'project':
        return <FolderKanban className="h-4 w-4" />;
      case 'epic':
        return <Target className="h-4 w-4" />;
      case 'sprint':
        return <Zap className="h-4 w-4" />;
      case 'requirement':
      case 'client-requirement':
        return <FileText className="h-4 w-4" />;
      default:
        return <Search className="h-4 w-4" />;
    }
  };

  return (
    /* shouldFilter={false}: both lists below are ALREADY filtered — the actions
       by `filteredActions`, the records by the server-side search. Leaving
       cmdk's own scorer on meant it re-filtered the async results against the
       typed text and dropped every one of them, so the palette answered "No
       results found." even for the exact title of an existing record. */
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder="Type a command or search..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        {/* Rendered by hand rather than with <CommandEmpty>, which only knows
            about cmdk's own filtering and never appears once that is off. */}
        {!hasAnything && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {isLoading ? 'Searching…' : 'No results found.'}
          </div>
        )}

        {/* Search Results */}
        {searchResults.length > 0 && (
          <>
            <CommandGroup heading="Search Results">
              {searchResults.slice(0, 10).map((result) => (
                <CommandItem
                  key={result.id}
                  onSelect={() => {
                    router.push(searchResultUrl(result));
                    setOpen(false);
                  }}
                  className="flex items-center gap-3"
                >
                  {getResultIcon(result.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate" title={result.title}>{result.title}</span>
                      {result.hierarchyId && (
                        <Badge variant="outline" className="text-xs">
                          {result.hierarchyId}
                        </Badge>
                      )}
                    </div>
                    {result.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {result.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {searchTypeLabel(result.type)}
                      </Badge>
                      {result.matchedFields.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Match: {result.matchedFields.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Action Groups */}
        {Object.entries(groupedActions).map(([group, actions]) => (
          <React.Fragment key={group}>
            <CommandGroup heading={group}>
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={action.onSelect}
                  className="flex items-center gap-3"
                >
                  {action.icon}
                  <span className="flex-1">{action.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </React.Fragment>
        ))}
      </CommandList>

      <div className="flex items-center justify-center gap-2 p-2 border-t bg-muted/50 text-xs text-muted-foreground">
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-2xs font-medium">
          <span className="text-xs">{modKey}</span>K
        </kbd>
        <span>to open</span>
        <span>•</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-2xs font-medium">
          ESC
        </kbd>
        <span>to close</span>
      </div>
    </CommandDialog>
  );
}
