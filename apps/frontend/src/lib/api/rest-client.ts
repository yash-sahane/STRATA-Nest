/**
 * Thin REST client for the backend API.
 *
 * - Uses fetch + httpOnly cookies (no manual Authorization header).
 * - On 401, attempts a single silent refresh and retries the original request.
 * - Throws ApiError with message/code/type from the backend error envelope.
 */

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

export class ApiError extends Error {
  code: number;
  type: string;
  constructor(message: string, code: number, type = 'ApiError') {
    super(message);
    this.code = code;
    this.type = type;
  }
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

function csrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? { 'X-CSRFToken': decodeURIComponent(m[1]) } : {};
}

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

  if (response.status === 401 && !isRetry && !path.startsWith('/api/v1/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) return doFetch(path, opts, true);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = data?.error ?? data;
    const message = error?.message || error?.detail || response.statusText;
    throw new ApiError(message, response.status, error?.type || 'ApiError');
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
