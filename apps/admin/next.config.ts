import path from 'node:path';
import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy. The portal talks only to its own origin (/api/* is proxied server-side),
 * so everything is 'self'. Next.js injects small inline bootstrap scripts, hence 'unsafe-inline'
 * for scripts; no remote script, frame or object sources are allowed.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  // Test builds use a separate folder so they never replace the files of a running portal.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Container builds (Dockerfile) produce a self-contained server.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') }
    : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * /api/* normally goes through src/app/api/[...path]/route.ts (reads API_URL per request). On
   * hosts where that route would run as a size-limited serverless function (Vercel: 4.5 MB request
   * bodies), set API_PROXY_MODE=rewrite: the platform then streams /api/* to API_URL itself, so
   * large uploads work. API_URL must be set at build time in that mode.
   */
  async rewrites() {
    if (process.env.API_PROXY_MODE !== 'rewrite') return [];
    const api = process.env.API_URL;
    if (!api) throw new Error('API_PROXY_MODE=rewrite needs API_URL at build time');
    return {
      beforeFiles: [{ source: '/api/:path*', destination: `${api.replace(/\/$/, '')}/api/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};

export default config;
