import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False in the server's HTML and until React has hydrated the page; true after.
 *
 * A form in the server's HTML can be submitted before its onSubmit exists, and the
 * browser then submits it itself — a GET with every named field in the query
 * string. Submit buttons of such forms wait for this.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
