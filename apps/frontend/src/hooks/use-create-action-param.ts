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
export function useCreateActionParam(onCreate: () => void, ready = true): void {
  const searchParams = useSearchParams();
  const isCreate = searchParams.get('action') === 'create';
  // Keep the latest callback without making the effect depend on its identity —
  // pages define these inline, so a dependency would re-fire it every render.
  const handler = React.useRef(onCreate);
  handler.current = onCreate;
  // Once per arrival: opening the dialog re-renders, and the parameter is gone
  // by then, but a guard makes that ordering explicit rather than incidental.
  const consumed = React.useRef(false);

  React.useEffect(() => {
    if (!isCreate) {
      consumed.current = false;
      return;
    }
    if (!ready || consumed.current) return;
    consumed.current = true;

    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    handler.current();
  }, [isCreate, ready]);
}
