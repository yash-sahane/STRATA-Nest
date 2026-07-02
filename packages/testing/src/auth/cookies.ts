/**
 * Cookie helpers for auth tests (mirrors the frozen cookie names — ADR-0003/0009).
 * Once AuthModule lands, a `mintTestToken` helper will be added here so tests can
 * create valid sessions without hitting the login endpoint.
 */
export const ACCESS_COOKIE = 'lt_access';
export const REFRESH_COOKIE = 'lt_refresh';

/** Build a `Cookie` request header carrying access (and optional refresh) tokens. */
export function authCookieHeader(accessToken: string, refreshToken?: string): string {
  const parts = [`${ACCESS_COOKIE}=${accessToken}`];
  if (refreshToken) parts.push(`${REFRESH_COOKIE}=${refreshToken}`);
  return parts.join('; ');
}

export interface ParsedCookie {
  value: string;
  attrs: Record<string, string>;
}

/**
 * Parse a `Set-Cookie` response header array into name → { value, attrs }.
 * Lets contract tests assert cookie flags (HttpOnly, SameSite, Max-Age, …) match Django.
 */
export function parseSetCookies(setCookie: string[] | undefined): Record<string, ParsedCookie> {
  const out: Record<string, ParsedCookie> = {};
  for (const line of setCookie ?? []) {
    const [pair, ...rest] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const attrs: Record<string, string> = {};
    for (const a of rest) {
      const [k, v] = a.split('=');
      attrs[k.trim().toLowerCase()] = (v ?? '').trim();
    }
    out[name] = { value, attrs };
  }
  return out;
}
