/**
 * Thin REST client for the backend API.
 *
 * - Uses fetch + httpOnly cookies (no manual Authorization header).
 * - On 401, attempts a single silent refresh and retries the original request
 *   (`fetchWithSession` below does the same for requests restClient cannot send).
 * - Throws ApiError with message/code/type/details from the backend error
 *   envelope (`details` = the raw parsed `error` object, for field-level errors).
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

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
  params?: Record<string, unknown> | URLSearchParams | Array<[string, string]>;
  body?: unknown;
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

async function doFetch(path: string, opts: Options = {}, isRetry = false): Promise<unknown> {
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
    const renewal = await tryRefresh();
    if (renewal.outcome === 'renewed') return doFetch(path, opts, true);
    if (renewal.outcome === 'unavailable') throw renewalUnavailable(renewal);
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

/**
 * What an attempt to renew the session came to.
 *
 * `rejected` is the API saying the refresh cookie is no good (401/403): signed out.
 * `unavailable` is everything else that is not a success — a 429, a 5xx, no
 * network — after which the cookie's validity is simply unknown.
 */
type Renewal =
  | { outcome: 'renewed' }
  | { outcome: 'rejected' }
  | { outcome: 'unavailable'; status?: number; retryAfterMs?: number };
export type SessionRenewal = Renewal['outcome'];

/** Attempts at a refresh that keeps failing for a reason that may pass, and the longest wait between them. */
const REFRESH_ATTEMPTS = 3;
const MAX_REFRESH_WAIT_MS = 10_000;
/** Shared by every tab: when the session was last renewed, in ms since the epoch. */
const REFRESHED_AT_KEY = 'strata:session-refreshed-at';
/** How recent another tab's renewal has to be for this one to use it instead of its own. */
const RECENTLY_REFRESHED_MS = 5_000;

function refreshedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(REFRESHED_AT_KEY));
    return at > 0 && Date.now() - at < RECENTLY_REFRESHED_MS;
  } catch {
    return false; // No storage (a locked-down browser): every tab renews for itself.
  }
}

function markRefreshed(): void {
  try {
    window.localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
  } catch {
    /* see refreshedRecently */
  }
}

async function refreshOnce(): Promise<Renewal> {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}/api/v1/auth/refresh/`, { method: 'POST', credentials: 'include' });
  } catch {
    return { outcome: 'unavailable' };
  }
  if (r.ok) return { outcome: 'renewed' };
  if (r.status === 401 || r.status === 403) return { outcome: 'rejected' };
  return { outcome: 'unavailable', status: r.status, retryAfterMs: retryAfterMs(r) };
}

/**
 * Renew the session, once per tab at a time — and one TAB at a time.
 *
 * A refresh token is single-use: the server rotates it and refuses it again.
 * Two tabs whose access tokens expired together both sent the same cookie, the
 * first rotated it, and the second was refused and signed that tab out. The
 * Web Locks API queues them across tabs, so the second sends the cookie the
 * first was just given — or, when the first finished a moment ago, sends nothing
 * at all: the cookie jar is shared, so its renewal is already this tab's. Every
 * tab refreshing in turn is what ran into the refresh endpoint's rate limit.
 *
 * Only a 401/403 means signed out. A 429 or a 5xx from refresh used to be read
 * the same way — the caller's 401 went up the stack, and the app sent somebody
 * whose refresh cookie was perfectly good to the sign-in page. Those are now
 * retried, as long as Retry-After asks (within reason), and if they keep failing
 * the caller is told the session could not be renewed JUST NOW, not that it is gone.
 */
let refreshInFlight: Promise<Renewal> | null = null;
async function tryRefresh(): Promise<Renewal> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = async (): Promise<Renewal> => {
    if (refreshedRecently()) return { outcome: 'renewed' };
    let renewal = await refreshOnce();
    for (let attempt = 1; renewal.outcome === 'unavailable' && attempt < REFRESH_ATTEMPTS; attempt += 1) {
      const wait = renewal.retryAfterMs ?? 1_000 * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, MAX_REFRESH_WAIT_MS)));
      renewal = await refreshOnce();
    }
    if (renewal.outcome === 'renewed') markRefreshed();
    if (renewal.outcome === 'rejected') refreshRejected = true;
    return renewal;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  refreshInFlight = (locks ? locks.request('strata-session-refresh', refresh) : refresh()).finally(
    () => {
      refreshInFlight = null;
    }
  );
  return refreshInFlight;
}

/**
 * The error for a 401 whose renewal could not be completed right now.
 *
 * Deliberately not a 401: everything above reads a 401 as "signed out" — the auth
 * provider clears the user and the shell goes to /login. This carries the refresh's
 * own status and Retry-After instead (a 429 is retried by the query client when it
 * asks), and 503 when there was no answer at all.
 */
function renewalUnavailable(renewal: Extract<Renewal, { outcome: 'unavailable' }>): ApiError {
  return new ApiError(
    'Your session could not be renewed just now. You are still signed in — try again in a moment.',
    renewal.status ?? 503,
    'SessionRenewalUnavailable',
    null,
    renewal.retryAfterMs,
  );
}

/**
 * Renew the session for something that is not a request — the realtime socket,
 * which the server closes when the access token it was opened with expires.
 */
export async function renewSession(): Promise<SessionRenewal> {
  if (refreshRejected) return 'rejected';
  return (await tryRefresh()).outcome;
}

/**
 * `fetch`, with the session renewal restClient gives its own calls.
 *
 * For what restClient cannot send — a multipart upload, the app's own Next routes
 * (/api/ai-generate, /api/parse-pdf), which answer 401 when the session cookie
 * they forward to the API has lapsed. These used bare `fetch`, so fifteen idle
 * minutes left them failing with 401 — and every retry failed the same way — until
 * some other screen happened to make a REST call and renew the session.
 *
 * On a 401: renew (the same single-flight, cross-tab refresh) and send once more.
 * A body that can be sent twice is required — FormData and strings can.
 */
export async function fetchWithSession(input: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(input, { credentials: 'include', ...init });
  const response = await send();
  if (response.ok) refreshRejected = false;
  if (response.status !== 401 || refreshRejected) return response;
  const renewal = await tryRefresh();
  if (renewal.outcome === 'renewed') return send();
  if (renewal.outcome === 'unavailable') throw renewalUnavailable(renewal);
  return response;
}

export const restClient = {
  get: <T = unknown>(path: string, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'GET' }) as Promise<T>,
  post: <T = unknown>(path: string, body?: unknown, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'POST', body }) as Promise<T>,
  patch: <T = unknown>(path: string, body?: unknown, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'PATCH', body }) as Promise<T>,
  put: <T = unknown>(path: string, body?: unknown, opts: Options = {}) =>
    doFetch(path, { ...opts, method: 'PUT', body }) as Promise<T>,
  delete: (path: string, opts: Options = {}) => doFetch(path, { ...opts, method: 'DELETE' }),
};

export { API_BASE };
