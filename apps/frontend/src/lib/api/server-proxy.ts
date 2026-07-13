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
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

export interface ProxyOptions {
  method?: string;
  body?: any;
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
): Promise<{ status: number; data: any }> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers || {}),
  };
  const cookie = request.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;
  const csrf = request.headers.get('x-csrftoken');
  if (csrf) headers['X-CSRFToken'] = csrf;

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
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: upstream.status, data };
}
