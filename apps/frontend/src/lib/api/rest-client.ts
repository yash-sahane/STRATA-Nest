/**
 * Thin REST client for the backend API.
 *
 * - Uses fetch + httpOnly cookies (no manual Authorization header).
 * - On 401, attempts a single silent refresh and retries the original request.
 * - Throws ApiError with message/code/type/details from the backend error
 *   envelope (`details` = the raw parsed `error` object, for field-level errors).
 */

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

export class ApiError extends Error {
  code: number;
  type: string;
  /**
   * `Retry-After`, in milliseconds, when the server sent one.
   *
   * Only a 429 and a 503 carry it, and it is the difference between guessing at a backoff
   * and being told. Undefined when absent or unparseable — a caller that wants to retry
   * then picks its own delay rather than treating "no header" as "retry immediately".
   */
  retryAfterMs?: number;
  /**
   * The parsed error body (`data.error`, or the whole payload when the envelope
   * is missing). `details.message` is a string for domain errors but an array of
   * strings — or a field->errors map — for ValidationPipe failures, so callers
   * that want field-level messages read this instead of re-parsing `message`.
   * `null` when the response had no JSON body.
   */
  details: unknown;
  constructor(
    message: string,
    code: number,
    type = 'ApiError',
    details: unknown = null,
    retryAfterMs?: number,
  ) {
    super(message);
    this.code = code;
    this.type = type;
    this.details = details;
    this.retryAfterMs = retryAfterMs;
  }
}

/** `Retry-After` as milliseconds. Seconds per RFC 9110; an HTTP-date is also legal. */
function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/**
 * Flatten the envelope's `message` (string | string[] | Record<string, unknown>)
 * into one displayable line. Without this an array/dict message reached
 * `new Error(...)` and rendered as `a,b` or `[object Object]` in a toast.
 */
function flattenMessage(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((m) => flattenMessage(m)).filter(Boolean).join(', ');
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([field, msgs]) => `${field}: ${flattenMessage(msgs)}`)
      .filter(Boolean)
      .join('; ');
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

interface Options {
  method?: string;
  params?: Record<string, any> | URLSearchParams | Array<[string, string]>;
  body?: any;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildQuery(params?: Options['params']): string {
  if (!params) return '';
  if (params instanceof URLSearchParams) return `?${params.toString()}`;
  const sp = new URLSearchParams();
  if (Array.isArray(params)) {
    params.forEach(([k, v]) => sp.append(k, v));
  } else {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) v.forEach((item) => sp.append(k, String(item)));
      else sp.append(k, String(v));
    });
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * A parsed JSON response body, shaped only where the error path reads it.
 * The index signature keeps every other field reachable for callers, which
 * receive the value back as-is.
 */
interface ResponseBody {
  message?: unknown;
  detail?: unknown;
  type?: string;
  error?: ResponseBody;
  [key: string]: unknown;
}

function csrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? { 'X-CSRFToken': decodeURIComponent(m[1]) } : {};
}

/**
 * Endpoints where a 401 must NOT trigger refresh-and-retry.
 *
 * This used to be the blanket test `path.startsWith('/api/v1/auth/')`, which
 * also covered `/auth/me/` — the call the app makes on every page load. The
 * effect was that an expired ACCESS token was read as "logged out" and the user
 * was bounced to /login, while a perfectly valid 7-day refresh cookie sat
 * unused: refresh recovered every other endpoint but never the one that runs
 * first. Only these four are genuinely unrecoverable — `refresh` would recurse,
 * and on the rest a 401 IS the answer rather than an expired session.
 */
const NO_REFRESH_RETRY = [
  '/api/v1/auth/refresh',
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/auth/password-reset',
];

const skipsRefreshRetry = (path: string): boolean =>
  NO_REFRESH_RETRY.some((p) => path.startsWith(p));

/**
 * Something a signed-out user can act on, in place of the API's "Unauthorized".
 *
 * A 401 that reaches the error below on an ordinary endpoint has already been through
 * refresh-and-retry and lost, so the session is genuinely gone. The backend's word for
 * that is correct protocol-speak and tells the person nothing: measured, a save with no
 * valid session raised a toast reading exactly `Unauthorized`, while their work sat in a
 * dialog they had no reason to believe was still holding it.
 *
 * The four endpoints on NO_REFRESH_RETRY are left alone — a 401 from `login` means the
 * credentials were wrong, and "your session has ended" would be a lie.
 */
function expiredSessionMessage(status: number, path: string): string | null {
  if (status !== 401 || skipsRefreshRetry(path)) return null;
  return 'Your session has ended. Sign in again — your changes are still on this page.';
}

/**
 * Set once the API has answered a refresh with "that cookie is not valid"
 * (401/403). A visitor who is simply signed out has no refresh cookie at all,
 * so every later 401 fired another refresh that could only 401 too — doubling
 * both the request count and the browser's console noise to reach an answer
 * already known. Cleared by any 2xx, which proves credentials exist again.
 *
 * Only 401/403 sets it. A network failure or a 5xx leaves the cookie's validity
 * unknown, and giving up on those would turn a blip into a forced logout.
 */
let refreshRejected = false;

async function doFetch(path: string, opts: Options = {}, isRetry = false): Promise<any> {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}${buildQuery(opts.params)}`;
  const init: RequestInit = {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...csrfHeader(),
      ...(opts.headers || {}),
    },
    signal: opts.signal,
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  const response = await fetch(url, init);
  if (response.ok) refreshRejected = false;

  if (response.status === 401 && !isRetry && !refreshRejected && !skipsRefreshRetry(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return doFetch(path, opts, true);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  let data: ResponseBody | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body: a gateway/proxy HTML error page, a dev-server stack
      // trace, a crash that escaped the backend's exception filter. Callers
      // only ever handle ApiError, so never let the SyntaxError escape.
      throw new ApiError(
        response.ok
          ? 'Received an invalid response from the server.'
          : response.statusText || `Request failed with status ${response.status}`,
        response.status,
        'ApiError',
      );
    }
  }
  if (!response.ok) {
    const error = data?.error ?? data;
    const message =
      flattenMessage(error?.message) ||
      flattenMessage(error?.detail) ||
      response.statusText ||
      `Request failed with status ${response.status}`;
    throw new ApiError(
      expiredSessionMessage(response.status, path) ?? message,
      response.status,
      error?.type || 'ApiError',
      error ?? null,
      retryAfterMs(response),
    );
  }
  return data;
}

let refreshInFlight: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/refresh/`, {
        method: 'POST',
        credentials: 'include',
      });
      if (r.status === 401 || r.status === 403) refreshRejected = true;
      return r.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const restClient = {
  get: (path: string, opts: Options = {}) => doFetch(path, { ...opts, method: 'GET' }),
  post: (path: string, body?: any, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'POST', body }),
  patch: (path: string, body?: any, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'PATCH', body }),
  put: (path: string, body?: any, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'PUT', body }),
  delete: (path: string, opts: Options = {}) => doFetch(path, { ...opts, method: 'DELETE' }),
};

export { API_BASE };
