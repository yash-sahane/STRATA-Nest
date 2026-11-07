/**
 * Where to go after signing in: the page somebody was on when their session ran out.
 *
 * The shell sent a signed-out visitor to a bare /login and sign-in always landed on
 * /dashboard, so a link from an e-mail, a bookmark, or a page left open overnight
 * cost the person their place every time. The page now rides along as `?next=`.
 */

/**
 * The routes a visitor is expected to reach while signed out. Asking `auth/me`
 * there is a question whose answer is already known — it 401s every time, and
 * the browser prints "Failed to load resource: 401" for a failed request no
 * matter how gracefully the app handles the rejection. So the very first screen
 * anyone sees came with a burst of red console errors describing the normal
 * path. Nothing rendered on these routes reads `user`, so nothing is lost by
 * not asking.
 *
 * `/change-password` is deliberately absent: it sits in the same route group
 * but is an authenticated screen (the forced temporary-password change), and it
 * does read `user`.
 */
export const PUBLIC_AUTH_ROUTES = ['/login', '/forgot-password', '/reset-password'];

export const isPublicAuthRoute = (pathname: string | null): boolean =>
  !!pathname && PUBLIC_AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/**
 * `raw` as a path on THIS site, or null.
 *
 * `next` is read from the address bar, so it is whatever a link said it was. An
 * absolute URL, `//elsewhere.example` (protocol-relative) or `/\elsewhere.example`
 * (browsers read the backslash as a slash) would make the sign-in page a
 * redirector to anywhere — a phishing page that the real login hands people to.
 * Resolving it against this origin and insisting the origin is unchanged is the
 * check that matters; the prefix tests only refuse the obvious early.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || typeof window === 'undefined') return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Back to a signed-out screen would be a loop; a route handler is not a page.
  if (isPublicAuthRoute(url.pathname) || url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login`, carrying the page to come back to (when there is one worth carrying). */
export function loginPathReturningTo(path: string | null | undefined): string {
  const next = safeReturnPath(path);
  return next && next !== '/dashboard' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** The `next` the current address carries, checked — for the signed-out screens. */
export function currentReturnPath(): string | null {
  if (typeof window === 'undefined') return null;
  return safeReturnPath(new URLSearchParams(window.location.search).get('next'));
}
