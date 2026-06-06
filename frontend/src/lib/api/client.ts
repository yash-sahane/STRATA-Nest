import { authClient } from './auth-client';
import { resolveSlug } from './collection-slugs';
import { restClient } from './rest-client';
import { id, query, translateQueries, type QueryInput, type QueryOp } from './query';
import type { ApiModels } from './types';

function basePath(collectionId: string): string {
  return `/api/v1/${resolveSlug(collectionId)}/`;
}

export const resources = {
  async list<T = any>(
    collectionId: string,
    queries: QueryInput[] = [],
  ): Promise<ApiModels.ResourceList<T>> {
    const params = translateQueries(queries);
    return restClient.get(basePath(collectionId), { params });
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
