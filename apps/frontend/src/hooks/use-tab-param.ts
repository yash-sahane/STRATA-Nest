'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Tab selection that lives in the URL, so refresh, Back and a shared link all land
 * on the tab the user was looking at.
 *
 * Two halves, and the pages that needed this each had only one:
 *
 *  - /settings READ `?tab=` and never wrote it back, so clicking a tab changed the
 *    screen but not the address. Refreshing or pressing Back jumped to whatever the
 *    URL still said — usually Profile.
 *  - /attendance did neither: `<Tabs defaultValue="today">`, so `?tab=team` was
 *    ignored and /attendance/team redirected onto the Today tab.
 *
 * WHY LOCAL STATE RATHER THAN READING THE URL EVERY RENDER
 *
 * The obvious version — derive the active tab from `useSearchParams()` and write
 * back with `router.replace` — does not work on these routes, and the failure is
 * silent. Measured on both pages, loading `/settings?tab=security` and clicking
 * Appearance:
 *
 *     [useTabParam] next= appearance from= tab=security -> target= /settings?tab=appearance
 *
 * so the handler ran and computed the right destination, `router.replace` was
 * called, and the address bar never changed. Both pages are statically prerendered
 * (`○` in the build output) and the soft navigation does not take. From a CLEAN url
 * the first write appeared to work, which is why a test that started without a
 * query passed while every real interaction after a deep link was stuck.
 *
 * So the render source is local state, and the URL is written as a side effect with
 * `history.replaceState` — the tab responds immediately, and a reload or a shared
 * link still reads the query because the server sees it. `replaceState`, not
 * `pushState`: a tab is a view of one page, and pushing would make Back walk
 * through every tab the user glanced at before leaving.
 */
export function useTabParam<T extends string>(
  valid: readonly T[],
  fallback: T,
  param = 'tab',
): [T, (next: T) => void] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get(param);

  const isValid = React.useCallback(
    (v: string | null): v is T => Boolean(v) && (valid as readonly string[]).includes(v as string),
    [valid],
  );

  const [tab, setTabState] = React.useState<T>(() => (isValid(fromUrl) ? fromUrl : fallback));

  /**
   * The last value this hook wrote to the URL.
   *
   * Without it the sync effect below fights the click: the user picks Appearance,
   * the URL has not caught up yet, the effect sees `security` and puts it straight
   * back. Only a URL value we did NOT write counts as somebody navigating.
   */
  const written = React.useRef<string | null>(fromUrl);

  React.useEffect(() => {
    if (!isValid(fromUrl)) return;
    if (fromUrl === written.current) return;
    written.current = fromUrl;
    setTabState(fromUrl);
  }, [fromUrl, isValid]);

  const setTab = React.useCallback(
    (next: T) => {
      setTabState(next);
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      if (next === fallback) {
        // Keep the default tab's URL clean rather than pinning ?tab=today onto it.
        params.delete(param);
      } else {
        params.set(param, next);
      }
      written.current = next === fallback ? null : next;
      const query = params.toString();
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
    },
    [fallback, param, pathname],
  );

  return [tab, setTab];
}

/**
 * Remove a one-shot deep-link parameter once it has been acted on.
 *
 * A parameter like `?frId=` describes an ACTION — open this thing — not a state, so
 * it stops being true the moment it is carried out. Left in place, dismissing the
 * dialog and refreshing re-opens it, which is the URL insisting on something the
 * user explicitly closed.
 *
 * Uses `history.replaceState` for the same reason as the tab writer above: a
 * `router.replace` on these prerendered routes does not take.
 */
export function useConsumeParam(param: string, consumed: boolean): void {
  React.useEffect(() => {
    if (!consumed || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get(param)) return;
    params.delete(param);
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [consumed, param]);
}
