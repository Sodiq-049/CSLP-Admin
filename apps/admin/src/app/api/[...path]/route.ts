import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the shared API (docs/04 §2). The browser calls /api/* on the admin host,
 * so httpOnly auth cookies stay first-party. Unlike next.config rewrites (resolved at build
 * time), API_URL is read per request, so one build can be deployed to any environment.
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = [
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'expect',
  'te',
  'trailer',
];

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const target = new URL(
    `/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`,
    base,
  );

  const headers = new Headers(req.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      {
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'The API is unreachable. Please try again shortly.',
          requestId: '',
        },
      },
      { status: 503 },
    );
  }

  const out = new Headers(upstream.headers);
  // fetch() already decoded the body; length/encoding no longer match.
  for (const h of ['content-encoding', 'content-length', 'transfer-encoding', 'connection'])
    out.delete(h);
  out.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
};
