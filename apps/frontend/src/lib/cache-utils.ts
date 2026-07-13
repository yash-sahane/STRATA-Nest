import { QueryClient } from '@tanstack/react-query';
import { getWorkspaceScopedKeys } from './query-keys';

/**
 * Cache management utilities for workspace switching
 */

/**
 * Clear all workspace-scoped queries from the cache
 * This prevents data leakage when switching between workspaces
 */
export function clearWorkspaceScopedCache(queryClient: QueryClient): void {
    const workspaceKeys = getWorkspaceScopedKeys();

    workspaceKeys.forEach((queryKey) => {
        queryClient.removeQueries({ queryKey });
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
    const workspaceKeys = getWorkspaceScopedKeys();

    workspaceKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
    });
}
