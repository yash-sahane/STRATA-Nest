import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { InlineLoader } from '@/components/ui/page-loader';

interface QueryStateProps {
  /**
   * Pass react-query's `isLoading` (true only on the FIRST load, before any
   * cached data) — not `isFetching`. That keeps already-loaded content visible
   * during background refetches instead of flashing a spinner (LOAD-04).
   */
  isLoading: boolean;
  isError?: boolean;
  /** True when the request succeeded but there is nothing to show. */
  isEmpty?: boolean;
  /** Retry handler for the error state (e.g. the query's `refetch`). */
  onRetry?: () => void;
  /** Override the default loader — e.g. a page-shaped Skeleton for initial load. */
  loading?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
}

/**
 * One contract for the loading / error / empty / content states of a data
 * fetch, so every page handles them identically. Precedence: loading → error →
 * empty → content. Each state has a sensible default that any page can override.
 */
export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loading,
  error,
  empty,
  children,
}: QueryStateProps) {
  if (isLoading) return <>{loading ?? <InlineLoader />}</>;
  if (isError) return <>{error ?? <ErrorState onRetry={onRetry} />}</>;
  if (isEmpty) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return <>{children}</>;
}
