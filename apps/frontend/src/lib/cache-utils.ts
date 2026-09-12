import { QueryClient } from '@tanstack/react-query';
import { isWorkspaceScopedKey } from './query-keys';

/**
 * Cache management utilities for workspace switching
 */

/**
 * Clear all workspace-scoped queries from the cache
 * This prevents data leakage when switching between workspaces
 *
 * Matching is done per query with `isWorkspaceScopedKey` instead of removing a
 * hand-maintained list of key roots: `removeQueries({ queryKey: ['team'] })`
 * only matches keys whose first element is exactly 'team', so every root that
 * drifted from the key its hook registers used to clear nothing at all.
 */
export function clearWorkspaceScopedCache(queryClient: QueryClient): void {
    queryClient.removeQueries({
        predicate: (query) => isWorkspaceScopedKey(query.queryKey),
    });
}

/**
 * Clear all cached data (used when logging out or deleting workspace)
 */
export function clearAllCache(queryClient: QueryClient): void {
    queryClient.clear();
}

/**
 * Invalidate workspace-scoped queries to trigger refetch
 * Use this when workspace data changes but you want to keep the cache
 */
export function invalidateWorkspaceScopedCache(queryClient: QueryClient): void {
    queryClient.invalidateQueries({
        predicate: (query) => isWorkspaceScopedKey(query.queryKey),
    });
}
