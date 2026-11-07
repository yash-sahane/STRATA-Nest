/**
 * Server-side helper used by Next.js API routes that proxy requests to the
 * backend API. Mirrors `src/lib/api/rest-client.ts` but runs in Node, so it
 * forwards the user's auth cookies on the incoming request rather than
 * piggy-backing on `credentials: 'include'`.
 */

import type { NextRequest } from 'next/server';

const API_BASE = (
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

export interface ProxyOptions {
  method?: string;
  body?: unknown;
  /** Defaults to JSON — caller can override for multipart. */
  contentType?: string | null;
  /** Extra headers to forward (e.g. when the caller already has a content-type). */
  headers?: Record<string, string>;
}

/**
 * Forwards the request to the backend API and returns the parsed JSON response
 * together with the upstream status code. Forwards the cookie header verbatim
 * so the existing JWT/CSRF cookies authenticate the call.
 */
export async function proxyToApi(
  request: NextRequest,
  path: string,
  opts: ProxyOptions = {},
): Promise<{ status: number; data: unknown }> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  const cookie = request.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;
  // Forwarded so the API's origin check sees where the browser's request came
  // from. Dropped, every relayed write looked like a script's — no Origin —
  // and another site's form posted here went through.
  const origin = request.headers.get('origin');
  if (origin) headers.Origin = origin;

  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (opts.contentType === null) {
      bodyInit = opts.body as BodyInit;
    } else {
      headers['Content-Type'] = opts.contentType || 'application/json';
      bodyInit =
        typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }
  }

  const upstream = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: bodyInit,
  });
  const text = await upstream.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: upstream.status, data };
}

/**
 * Refuse a request another site made the browser send.
 *
 * These routes authenticate with the session cookie, which a browser attaches
 * to a cross-site form post as readily as to the app's own fetch — and a
 * `text/plain` body is still parsed by `request.json()`. Two rules: when the
 * browser says where the request came from, it must be this app; and the body
 * must be declared JSON (`expectJson`), which no cross-site form can send.
 * Returns the reason to refuse, or null.
 */
export function refuseCrossSite(request: NextRequest, opts: { expectJson?: boolean } = {}): string | null {
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    let from = '';
    try {
      from = new URL(origin).host;
    } catch {
      return 'This request came from a site that is not allowed to make it.';
    }
    if (from.toLowerCase() !== host.toLowerCase()) {
      return 'This request came from a site that is not allowed to make it.';
    }
  }
  if (opts.expectJson && !/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    return 'Send this request as JSON.';
  }
  return null;
}

/**
 * Session guard for the route handlers that do their work INSIDE Next instead
 * of proxying to the API — `/api/ai-generate` (a paid model call) and
 * `/api/parse-pdf` (a CPU- and disk-bound parse). Those never reach the backend,
 * so nothing else authenticates them and an anonymous POST could burn the
 * operator's model quota or pin a worker.
 *
 * Resolves the caller against the API's own session endpoint with their cookies
 * forwarded, so it is the same answer the rest of the app gets. Any non-200 —
 * including the API being unreachable — is treated as anonymous.
 */
export async function hasApiSession(request: NextRequest): Promise<boolean> {
  try {
    const { status } = await proxyToApi(request, '/api/v1/auth/me/');
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Whether the caller holds EVERY one of `keys` in `workspaceId` — answered by the
 * API, which understands custom workspace roles, rather than guessed at here.
 * `{ ok: false }` carries the status and message to answer with.
 *
 * Signed-in is not a high enough bar for the routes that work inside Next: they
 * spend the operator's model quota and CPU on authoring, so they ask for the
 * permissions the authoring itself needs.
 */
export async function checkWorkspacePermissions(
  request: NextRequest,
  workspaceId: unknown,
  keys: readonly string[],
  refusal: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'workspaceId is required so your permissions can be checked.',
    };
  }
  let answer: { status: number; data: unknown };
  try {
    answer = await proxyToApi(
      request,
      `/api/v1/auth/me/permissions/?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
  } catch {
    return { ok: false, status: 503, error: 'Your permissions could not be checked just now.' };
  }
  // A lapsed session, not a refusal: the browser renews it and asks again.
  if (answer.status === 401) return { ok: false, status: 401, error: 'Authentication required' };
  const granted: unknown = (answer.data as { permissions?: unknown } | null)?.permissions;
  const holds = (key: string) =>
    Array.isArray(granted) && (granted.includes('*') || granted.includes(key));
  if (answer.status !== 200 || !keys.every(holds)) {
    return { ok: false, status: 403, error: refusal };
  }
  return { ok: true };
}
