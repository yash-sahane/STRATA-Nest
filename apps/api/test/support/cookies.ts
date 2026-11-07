export interface ParsedCookie {
  value: string;
  attrs: Record<string, string>;
}

/**
 * Parse a `Set-Cookie` response header array into name → { value, attrs }, so a
 * test can assert the flags (HttpOnly, SameSite, Max-Age, …) the contract names.
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
