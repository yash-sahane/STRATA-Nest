'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Search } from 'lucide-react';
import { logger } from '@/lib/logger';

interface SearchHistoryItem {
  id: string;
  query: string;
  timestamp: number;
  resultCount?: number;
}

const MAX_HISTORY_ITEMS = 20;
const STORAGE_KEY = 'search-history';

/** localStorage is untrusted input: valid JSON that is not an array of items
 *  (schema drift, a tampered value) would otherwise reach `history.map` and
 *  `formatDistanceToNow`, crashing the header on every page. */
function isSearchHistoryItem(value: unknown): value is SearchHistoryItem {
  const item = value as SearchHistoryItem | null;
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.query === 'string' &&
    typeof item.timestamp === 'number' &&
    Number.isFinite(item.timestamp)
  );
}

export function useSearchHistory() {
  const [history, setHistory] = React.useState<SearchHistoryItem[]>([]);

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        setHistory(Array.isArray(parsed) ? parsed.filter(isSearchHistoryItem) : []);
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
