'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  FileText,
  FolderKanban,
  Target,
  Zap,
  Calendar,
  Users,
  Settings,
  BarChart3,
  Clock,
  CheckSquare,
  Home,
} from 'lucide-react';
import { useGlobalSearch } from '@/hooks/use-global-search';
import { useCurrentWorkspace } from '@/hooks/use-current-workspace';

type CommandAction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  shortcut?: string;
  group: string;
};

export function CommandPalette() {
  const router = useRouter();
  const { currentWorkspace } = useCurrentWorkspace();

  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');

  const { data: searchResults = [], isLoading } = useGlobalSearch(
    searchQuery,
    currentWorkspace?.id
  );

  // Keyboard shortcut (Cmd+K or Ctrl+K)
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Navigation actions
  const navigationActions: CommandAction[] = [
    {
      id: 'nav-home',
      label: 'Dashboard',
      icon: <Home className="h-4 w-4" />,
      onSelect: () => {
        router.push('/dashboard');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-tasks',
      label: 'Tasks',
      icon: <CheckSquare className="h-4 w-4" />,
      onSelect: () => {
        router.push('/tasks');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-projects',
      label: 'Projects',
      icon: <FolderKanban className="h-4 w-4" />,
      onSelect: () => {
        router.push('/projects');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-epics',
      label: 'Epics',
      icon: <Target className="h-4 w-4" />,
      onSelect: () => {
        router.push('/epics');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-sprints',
      label: 'Sprints',
      icon: <Zap className="h-4 w-4" />,
      onSelect: () => {
        router.push('/sprints');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-calendar',
      label: 'Calendar',
      icon: <Calendar className="h-4 w-4" />,
      onSelect: () => {
        router.push('/calendar');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-team',
      label: 'Team',
      icon: <Users className="h-4 w-4" />,
      onSelect: () => {
        router.push('/team');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-analytics',
      label: 'Analytics',
      icon: <BarChart3 className="h-4 w-4" />,
      onSelect: () => {
        router.push('/analytics');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-requirements',
      label: 'Requirements',
      icon: <FileText className="h-4 w-4" />,
      onSelect: () => {
        router.push('/requirements');
        setOpen(false);
      },
      group: 'Navigation',
    },
    {
      id: 'nav-activity',
      label: 'Activity Feed',
      icon: <Clock className="h-4 w-4" />,
      onSelect: () => {
        router.push('/activity');
        setOpen(false);
      },
      group: 'Navigation',
    },
  ];

  // Quick actions
  const quickActions: CommandAction[] = [
    {
      id: 'action-create-task',
      label: 'Create New Task',
      icon: <CheckSquare className="h-4 w-4" />,
      onSelect: () => {
        router.push('/tasks?action=create');
        setOpen(false);
      },
      shortcut: 'T',
      group: 'Actions',
    },
    {
      id: 'action-create-project',
      label: 'Create New Project',
      icon: <FolderKanban className="h-4 w-4" />,
      onSelect: () => {
        router.push('/projects?action=create');
        setOpen(false);
      },
      shortcut: 'P',
      group: 'Actions',
    },
    {
      id: 'action-create-epic',
      label: 'Create New Epic',
      icon: <Target className="h-4 w-4" />,
      onSelect: () => {
        router.push('/epics?action=create');
        setOpen(false);
      },
      shortcut: 'E',
      group: 'Actions',
    },
    {
      id: 'action-create-sprint',
      label: 'Create New Sprint',
      icon: <Zap className="h-4 w-4" />,
      onSelect: () => {
        router.push('/sprints?action=create');
        setOpen(false);
      },
      shortcut: 'S',
      group: 'Actions',
    },
  ];

  // Settings actions
  const settingsActions: CommandAction[] = [
    {
      id: 'settings-workspace',
      label: 'Workspace Settings',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => {
        router.push('/workspaces');
        setOpen(false);
      },
      group: 'Settings',
    },
    {
      id: 'settings-profile',
      label: 'Profile Settings',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => {
        router.push('/settings');
        setOpen(false);
      },
      group: 'Settings',
    },
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
        return <FileText className="h-4 w-4" />;
      default:
        return <Search className="h-4 w-4" />;
    }
  };

  const getResultUrl = (result: typeof searchResults[0]) => {
    switch (result.type) {
      case 'task':
        return `/tasks?taskId=${result.id}`;
      case 'project':
        return `/projects/${result.id}`;
      case 'epic':
        return `/epics?epicId=${result.id}`;
      case 'sprint':
        return `/sprints/${result.id}/board`;
      case 'requirement':
        return `/requirements?reqId=${result.id}`;
      default:
        return '/dashboard';
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Type a command or search..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>
          {isLoading ? 'Searching...' : 'No results found.'}
        </CommandEmpty>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <>
            <CommandGroup heading="Search Results">
              {searchResults.slice(0, 10).map((result) => (
                <CommandItem
                  key={result.id}
                  onSelect={() => {
                    router.push(getResultUrl(result));
                    setOpen(false);
                  }}
                  className="flex items-center gap-3"
                >
                  {getResultIcon(result.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{result.title}</span>
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
                      <Badge variant="secondary" className="text-xs capitalize">
                        {result.type}
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
                  {action.shortcut && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {action.shortcut}
                    </Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </React.Fragment>
        ))}
      </CommandList>

      <div className="flex items-center justify-center gap-2 p-2 border-t bg-muted/50 text-xs text-muted-foreground">
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
          <span className="text-xs">⌘</span>K
        </kbd>
        <span>to open</span>
        <span>•</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium">
          ESC
        </kbd>
        <span>to close</span>
      </div>
    </CommandDialog>
  );
}
