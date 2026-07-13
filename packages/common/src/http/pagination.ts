import type { PaginatedResponse } from '@strata/shared';

export const DEFAULT_PAGE_SIZE = 100; // used when the client omits pageSize
export const MAX_PAGE_SIZE = 1000; // upper bound; larger requests are clamped

/** Coerce/clamp raw page + pageSize query values to safe bounds. */
export function normalizePageParams(rawPage?: unknown, rawPageSize?: unknown): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Number.parseInt(String(rawPage ?? '1'), 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(String(rawPageSize ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Build the versioned pagination envelope:
 *   { items, total, page, pageSize }
 */
export function paginate<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResponse<T> {
  return { items, total, page, pageSize };
}
