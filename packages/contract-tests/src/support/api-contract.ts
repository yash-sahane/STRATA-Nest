/**
 * Tiny client for contract/characterization tests (ADR-0003, arch §19).
 *
 * Target is chosen by env so the SAME suite runs against either backend:
 *   - CONTRACT_BASE_URL  (explicit; use this to point at NestJS later)
 *   - DJANGO_API_URL     (default — the legacy API we lock the contract from)
 *
 * Uses Node's global fetch (Node >= 18). No runtime deps.
 */
export const BASE = (
  process.env.CONTRACT_BASE_URL ||
  process.env.DJANGO_API_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

/** Optional auth cookie ("lt_access=...") to exercise authenticated contracts. */
export const COOKIE = process.env.CONTRACT_COOKIE || '';

export interface ApiResult {
  status: number;
  body: unknown;
  headers: Headers;
}

export async function call(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers = new Headers(init.headers);
  if (COOKIE) headers.set('Cookie', COOKIE);
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
