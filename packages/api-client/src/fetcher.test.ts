import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch, configureApiClient } from './fetcher.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { cookie: 'cslp_csrf=tok%3D123; other=1' });
  });

  it('sends the CSRF header on mutations only', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, { data: 1, meta: { requestId: 'r' } }),
    );
    configureApiClient({ fetch: f as typeof fetch, baseUrl: 'http://x' });
    await apiFetch('/api/v1/a', { method: 'POST', body: '{}' });
    await apiFetch('/api/v1/a', { method: 'GET' });
    expect(new Headers(f.mock.calls[0]![1]!.headers).get('x-csrf-token')).toBe('tok=123');
    expect(new Headers(f.mock.calls[1]![1]!.headers).get('x-csrf-token')).toBeNull();
    expect(f.mock.calls[0]![1]!.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries; concurrent calls share one refresh', async () => {
    let refreshed = false;
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json(200, { data: { status: 'authenticated' } });
      }
      return refreshed
        ? json(200, { data: 'ok', meta: { requestId: 'r' } })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } });
    });
    configureApiClient({ fetch: f as typeof fetch, baseUrl: '' });
    const [a, b] = await Promise.all([
      apiFetch<{ data: string }>('/api/v1/x'),
      apiFetch<{ data: string }>('/api/v1/y'),
    ]);
    expect(a.data).toBe('ok');
    expect(b.data).toBe('ok');
    expect(f.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('throws ApiClientError with field errors and notifies on final 401', async () => {
    const onUnauthenticated = vi.fn();
    const f = vi.fn(async (url: string) =>
      url.endsWith('/auth/refresh')
        ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'r' } })
        : url.includes('bad')
          ? json(400, {
              error: {
                code: 'VALIDATION_FAILED',
                message: 'bad',
                details: [{ path: 'name', issue: 'Required' }],
                requestId: 'r',
              },
            })
          : json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired', requestId: 'r' } }),
    );
    configureApiClient({ fetch: f as typeof fetch, onUnauthenticated });
    const err = await apiFetch('/api/v1/bad', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.fieldErrors()).toEqual({ name: 'Required' });
    await expect(apiFetch('/api/v1/private')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});
