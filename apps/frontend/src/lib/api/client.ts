import { authClient } from './auth-client';
import { resolveSlug } from './collection-slugs';
import { restClient } from './rest-client';
import { id, query, translateQueries, type QueryInput, type QueryOp } from './query';
import type { ApiModels } from './types';

function basePath(collectionId: string): string {
  return `/api/v1/${resolveSlug(collectionId)}/`;
}

async function fetchList<T = any>(
  collectionId: string,
  queries: QueryInput[] = [],
): Promise<ApiModels.ResourceList<T>> {
  const params = translateQueries(queries);
  // NOTE: deliberately does NOT forward React Query's AbortSignal. Wiring it up
  // looked like free hygiene, but React Query cancels a query whose observer
  // re-reads its options, and with that cancellation actually honoured the
  // in-flight request was aborted with no replacement issued — the notification
  // badge simply never loaded. If this is revisited, verify the request still
  // completes rather than assuming a cancelled fetch is always superseded.
  return restClient.get(basePath(collectionId), { params });
}

export const resources = {
  list: fetchList,

  /**
   * Fetch every page of a list and return it as one ResourceList.
   *
   * A single response is capped at the backend's max page size, and the only
   * way to reach later pages is `page` — so any caller that needs the COMPLETE
   * set (search, aggregation, cascade) must walk the pages rather than trust a
   * single `limit()`. This does that transparently. Caller-supplied `limit`/
   * `page` ops are ignored (pagination is controlled here); `MAX_PAGES` bounds
   * the work so a runaway collection can't hang the client.
   */
  async listAll<T = any>(
    collectionId: string,
    queries: QueryInput[] = [],
  ): Promise<ApiModels.ResourceList<T>> {
    const PAGE_SIZE = 1000; // backend MAX_PAGE_SIZE
    const MAX_PAGES = 50; // safety ceiling: 50k rows
    const filters = queries.filter(
      (q) => typeof q === 'string' || (q.op !== 'limit' && q.op !== 'page'),
    );
    const readPage = (page: number) =>
      fetchList<T>(collectionId, [...filters, query.limit(PAGE_SIZE), query.page(page)]);

    // Page 1 tells us the total, and therefore how many pages remain.
    const first = await readPage(1);
    const total = first.total;
    const items: T[] = [...first.items];
    if (first.items.length === 0 || items.length >= total) {
      return { total, page: 1, pageSize: items.length, items };
    }

    /**
     * Fetch the rest in parallel rather than one after another.
     *
     * The walk used to be strictly sequential, so a 5,000-row collection cost
     * five round trips end to end and the board took ~13s to appear — almost
     * all of it waiting. The page count is known once page 1 returns, so the
     * remainder can go out at once. MAX_PAGES still bounds the work.
     */
    const lastPage = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) => readPage(i + 2)),
    );
    for (const res of rest) items.push(...res.items);

    return { total, page: 1, pageSize: items.length, items };
  },

  async get<T = any>(collectionId: string, resourceId: string): Promise<T> {
    return restClient.get(`${basePath(collectionId)}${resourceId}/`);
  },

  /**
   * The server owns id generation for every collection.
   *
   * `resourceId` is accepted and IGNORED. It used to be spread into the body as
   * `{ id, ...data }` behind a `resourceId !== 'unique()'` guard that never
   * fired — `id.unique()` is bound to `nativeId()`, which returns a random
   * 20-character string, never the literal `'unique()'` — so every call POSTed
   * an `id` field. No Create DTO declares one and main.ts runs
   * `ValidationPipe({ whitelist: true })`, so it was stripped in silence. That is
   * harmless only because every caller reads the id back off the response; the
   * shape READ as though the client controlled the primary key, which is a trap
   * for the next optimistic-cache or two-step create. The parameter is kept so
   * the 14 existing call sites still compile.
   */
  async create<T = any>(
    collectionId: string,
    _resourceId?: string,
    data: Record<string, unknown> = {},
    _permissions?: unknown[],
  ): Promise<T> {
    return restClient.post(basePath(collectionId), data);
  },

  async update<T = any>(
    collectionId: string,
    resourceId: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    return restClient.patch(`${basePath(collectionId)}${resourceId}/`, data);
  },

  async remove(collectionId: string, resourceId: string): Promise<void> {
    await restClient.delete(`${basePath(collectionId)}${resourceId}/`);
  },
};

export { authClient, id, query };
export type { ApiModels, QueryInput, QueryOp };
