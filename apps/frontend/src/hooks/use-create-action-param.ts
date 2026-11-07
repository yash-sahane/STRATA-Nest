'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Honour `?action=create` on a list page and then clear it from the URL.
 *
 * The command palette's four quick actions ("Create New Task/Project/Epic/
 * Sprint") all navigate to `<route>?action=create`, but no page ever read the
 * parameter — every one of them landed the user on the list and did nothing
 * else, while the palette advertised a keyboard shortcut for each.
 *
 * The parameter is consumed, so it is stripped with `history.replaceState`
 * rather than `router.replace`: this is a shallow URL correction, not a
 * navigation. Going through the router re-runs the route (and, in practice,
 * left the parameter on the address bar anyway), so a refresh or a
 * back-navigation would reopen a dialog the user had already closed.
 */
export function useCreateActionParam(
  onCreate: (params: URLSearchParams) => void,
  ready = true,
  /**
   * Parameters that travel with the request and are consumed with it — what the
   * new record belongs to (`?action=create&epicId=…`). The handler is given them,
   * and they leave the address bar with `action`.
   */
  carried: readonly string[] = [],
): void {
  const searchParams = useSearchParams();
  const isCreate = searchParams.get('action') === 'create';
  // Keep the latest callback without making the effect depend on its identity —
  // pages define these inline, so a dependency would re-fire it every render.
  const handler = React.useRef(onCreate);
  // Written in an effect, not during render. Assigning `handler.current` in the
  // render body is a side effect in a function React is allowed to call more
  // than once, discard, or replay — the compiler flags it, and under a discarded
  // render it publishes a callback belonging to a tree that was never committed.
  // Declared BEFORE the effect that reads it: React runs a component's effects in
  // declaration order within a commit, so the ref is current by the time the
  // consumer below runs, on the very first commit as well as later ones.
  React.useEffect(() => {
    handler.current = onCreate;
  }, [onCreate]);
  // Once per arrival: opening the dialog re-renders, and the parameter is gone
  // by then, but a guard makes that ordering explicit rather than incidental.
  const consumed = React.useRef(false);
  const carriedRef = React.useRef(carried);
  React.useEffect(() => {
    carriedRef.current = carried;
  }, [carried]);

  React.useEffect(() => {
    if (!isCreate) {
      consumed.current = false;
      return;
    }
    if (!ready || consumed.current) return;
    consumed.current = true;

    const url = new URL(window.location.href);
    const asked = new URLSearchParams(url.searchParams);
    url.searchParams.delete('action');
    for (const name of carriedRef.current) url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    handler.current(asked);
  }, [isCreate, ready]);
}
