/**
 * Tiny client for contract/regression tests.
 *
 * Locks the versioned wire contract (error envelope, pagination envelope, auth)
 * against the running NestJS API. Point it with CONTRACT_BASE_URL; the suite
 * no-ops when the target is unreachable (see isReachable).
 *
 * Uses Node's global fetch (Node >= 18). No runtime deps.
 */
export const BASE = (
  process.env.CONTRACT_BASE_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

/** Optional auth cookie ("strata_access=...") for the tests that need a session. */
export const COOKIE = process.env.CONTRACT_COOKIE || '';

export interface ApiResult {
  status: number;
  body: unknown;
  headers: Headers;
}

/**
 * One request. Anonymous unless `authenticated` is set — the unauthenticated
 * contracts ("me without a session is 401") must stay anonymous whether or not a
 * cookie was supplied for the others.
 */
export async function call(
  path: string,
  init: RequestInit = {},
  { authenticated = false }: { authenticated?: boolean } = {},
): Promise<ApiResult> {
  const headers = new Headers(init.headers);
  if (authenticated && COOKIE) headers.set('Cookie', COOKIE);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

/** True if the target API answers at all (used to skip when nothing is running). */
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/me/`, { method: 'GET' });
    return res.status > 0;
  } catch {
    return false;
  }
}
