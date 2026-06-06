'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Clock, X, TrendingUp, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { logger } from '@/lib/logger';

export interface SearchHistoryItem {
  id: string;
  query: string;
  timestamp: number;
  resultCount?: number;
}

const MAX_HISTORY_ITEMS = 20;
const STORAGE_KEY = 'search-history';

export function useSearchHistory() {
  const [history, setHistory] = React.useState<SearchHistoryItem[]>([]);

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SearchHistoryItem[];
        setHistory(parsed);
      }
    } catch (error) {
      logger.error('Failed to load search history', { error });
    }
  }, []);

  // Add to history
  const addToHistory = React.useCallback((query: string, resultCount?: number) => {
    // Type guard and validation
    if (typeof query !== 'string' || !query.trim()) {
      logger.warn('Invalid query passed to addToHistory', { query });
      return;
    }

    setHistory((prev) => {
      // Check if query already exists
      const existingIndex = prev.findIndex(
        (item) => item.query.toLowerCase() === query.toLowerCase()
      );

      let updated: SearchHistoryItem[];

      if (existingIndex >= 0) {
        // Move to top and update
        const existing = prev[existingIndex];
        updated = [
          { ...existing, timestamp: Date.now(), resultCount },
          ...prev.slice(0, existingIndex),
          ...prev.slice(existingIndex + 1),
        ];
      } else {
        // Add new entry
        updated = [
          {
            id: Date.now().toString(),
            query,
            timestamp: Date.now(),
            resultCount,
          },
          ...prev,
        ].slice(0, MAX_HISTORY_ITEMS); // Limit to MAX_HISTORY_ITEMS
      }

      // Save to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        logger.error('Failed to save search history', { error });
      }

      return updated;
    });
  }, []);

  // Remove from history
  const removeFromHistory = React.useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        logger.error('Failed to save search history', { error });
      }
      return updated;
    });
  }, []);

  // Clear all history
  const clearHistory = React.useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      logger.error('Failed to clear search history', { error });
    }
  }, []);

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
  };
}

interface SearchHistoryProps {
  onSelect: (query: string) => void;
}

export function SearchHistory({ onSelect }: SearchHistoryProps) {
  const { history, removeFromHistory, clearHistory } = useSearchHistory();
  const [open, setOpen] = React.useState(false);

  if (history.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2">
          <Clock className="h-4 w-4" />
          Recent
          <Badge variant="secondary" className="ml-1">
            {history.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Search History</h3>
          </div>
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="h-8 text-xs"
            >
              Clear All
            </Button>
          )}
        </div>

        <ScrollArea className="max-h-[300px]">
          <div className="p-2">
            {history.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onSelect(item.query);
                  setOpen(false);
                }}
                className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent cursor-pointer"
              >
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.query}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                    </p>
                    {item.resultCount !== undefined && (
                      <span className="text-xs text-muted-foreground">
                        • {item.resultCount} results
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromHistory(item.id);
                  }}
                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between p-3 border-t bg-muted/50">
          <p className="text-xs text-muted-foreground">
            Showing {history.length} of {MAX_HISTORY_ITEMS} max
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Top Searches Component (for displaying most frequent/recent)
interface TopSearchesProps {
  onSelect: (query: string) => void;
  maxItems?: number;
}

export function TopSearches({ onSelect, maxItems = 5 }: TopSearchesProps) {
  const { history } = useSearchHistory();

  const topSearches = React.useMemo(() => {
    return history.slice(0, maxItems);
  }, [history, maxItems]);

  if (topSearches.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <TrendingUp className="h-4 w-4" />
        Recent Searches
      </div>
      <div className="flex flex-wrap gap-2">
        {topSearches.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            size="sm"
            onClick={() => onSelect(item.query)}
            className="h-8 text-xs"
          >
            <Search className="h-3 w-3 mr-1" />
            {item.query}
            {item.resultCount !== undefined && (
              <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">
                {item.resultCount}
              </Badge>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
