import { subscribeToChannels } from './realtime-client';
import type { ApiModels } from './types';

export type RealtimeChannel = string;
export type RealtimeEventType = 'create' | 'update' | 'delete' | '*';

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

export function subscribeToRealtime(
  channels: RealtimeChannel[],
  callback: (response: ApiModels.RealtimeEvent<any>) => void,
): RealtimeSubscription {
  const unsubscribe = subscribeToChannels(channels, callback);
  return { unsubscribe };
}

export function subscribeToCollection(
  collectionId: string,
  callback: (response: ApiModels.RealtimeEvent<any>) => void,
): RealtimeSubscription {
  return subscribeToRealtime([collectionId], callback);
}

export function subscribeToDocument(
  collectionId: string,
  resourceId: string,
  callback: (response: ApiModels.RealtimeEvent<any>) => void,
): RealtimeSubscription {
  return subscribeToRealtime([`${collectionId}.${resourceId}`], callback);
}

export function getRealtimeEventType(event: string): 'create' | 'update' | 'delete' | 'unknown' {
  if (event.endsWith('.create')) return 'create';
  if (event.endsWith('.update')) return 'update';
  if (event.endsWith('.delete')) return 'delete';
  return 'unknown';
}

export const REALTIME_CONFIG = {
  COLLECTIONS: {
    COMMENTS: 'task_comments',
    NOTIFICATIONS: 'notifications',
    TASKS: 'tasks',
    SPRINTS: 'sprints',
    PROJECTS: 'projects',
  },
};

export const createChannels = {
  collection: (collectionId: string) => collectionId,
  document: (collectionId: string, resourceId: string) => `${collectionId}.${resourceId}`,
};

export type { ApiModels };