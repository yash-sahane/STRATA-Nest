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
    const items: T[] = [];
    let total = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await fetchList<T>(collectionId, [
        ...filters,
        query.limit(PAGE_SIZE),
        query.page(page),
      ]);
      items.push(...res.items);
      total = res.total;
      if (res.items.length === 0 || items.length >= total) break;
    }
    return { total, page: 1, pageSize: items.length, items };
  },

  async get<T = any>(collectionId: string, resourceId: string): Promise<T> {
    return restClient.get(`${basePath(collectionId)}${resourceId}/`);
  },

  async create<T = any>(
    collectionId: string,
    resourceId: string,
    data: Record<string, unknown>,
    _permissions?: unknown[],
  ): Promise<T> {
    const body = resourceId && resourceId !== 'unique()' ? { id: resourceId, ...data } : data;
    return restClient.post(basePath(collectionId), body);
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
