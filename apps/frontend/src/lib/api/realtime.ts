import { subscribeToChannels } from './realtime-client';
import type { ApiModels } from './types';

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

/** Every frame for one collection (COLLECTIONS in ./config names them). */
export function subscribeToCollection(
  collectionId: string,
  callback: (response: ApiModels.RealtimeEvent<Record<string, unknown>>) => void,
): RealtimeSubscription {
  const unsubscribe = subscribeToChannels([collectionId], callback);
  return { unsubscribe };
}

export function getRealtimeEventType(event: string): 'create' | 'update' | 'delete' | 'unknown' {
  if (event.endsWith('.create')) return 'create';
  if (event.endsWith('.update')) return 'update';
  if (event.endsWith('.delete')) return 'delete';
  return 'unknown';
}

export type { ApiModels };