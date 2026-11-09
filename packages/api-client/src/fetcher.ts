/**
 * The single HTTP entry point used by every generated hook (docs/04 §2).
 *  - Browser (admin/web): same-origin cookies + double-submit CSRF header.
 *  - Mobile: bearer token supplied via `getAccessToken`.
 *  - On 401 UNAUTHENTICATED: one single-flight refresh, then the request is retried once.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; issue: string }[];
    requestId: string;
  };
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody['error'],
  ) {
    super(body.message);
    this.name = 'ApiClientError';
  }
  get code() {
    return this.body.code;
  }
  /** Field → message map, handy for react-hook-form `setError`. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.body.details ?? []).map((d) => [d.path, d.issue]));
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Mobile: perform a token refresh and return true on success. Browser default calls /auth/refresh. */
  refresh?: () => Promise<boolean>;
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
}

let config: ApiClientConfig = { baseUrl: '' };
export function configureApiClient(next: Partial<ApiClientConfig>): void {
  config = { ...config, ...next };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

let refreshing: Promise<boolean> | null = null;
async function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if (config.refresh) return await config.refresh();
      const f = config.fetch ?? fetch;
      const r = await f(`${config.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (!SAFE.has(method)) {
    const csrf = readCookie('cslp_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }
  const token = await config.getAccessToken?.();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const f = config.fetch ?? fetch;
  return f(`${config.baseUrl}${url}`, { ...init, headers, credentials: 'include' });
}

const NO_RETRY = /\/auth\/(login|refresh|logout|mfa\/verify)$/;

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res = await send(url, init);
  if (res.status === 401 && !NO_RETRY.test(url.split('?')[0]!)) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as ApiErrorBody | null;
    if (body?.error.code === 'UNAUTHENTICATED' && (await refreshOnce()))
      res = await send(url, init);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const body: ApiErrorBody['error'] = json?.error ?? {
      code: 'INTERNAL',
      message: res.statusText,
      requestId: '',
    };
    if (res.status === 401 && body.code === 'UNAUTHENTICATED') config.onUnauthenticated?.();
    throw new ApiClientError(res.status, body);
  }
  return json as T;
}

export default apiFetch;

/** Picked up by Orval: generated hooks report `ApiClientError` as their error type. */
export type ErrorType<_E = unknown> = ApiClientError;
export type BodyType<B> = B;
