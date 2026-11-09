import type { Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { randomToken } from './crypto.js';
import { COOKIE } from './auth.types.js';

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  t: { accessToken: string; accessTtlSec: number; refreshToken: string; refreshExpiresAt: Date },
): void {
  const base = {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
  res.cookie(COOKIE.access, t.accessToken, {
    ...base,
    path: '/api',
    maxAge: t.accessTtlSec * 1000,
  });
  res.cookie(COOKIE.refresh, t.refreshToken, {
    ...base,
    path: '/api/v1/auth',
    expires: t.refreshExpiresAt,
  });
  // Double-submit CSRF token: readable by the admin app, echoed in X-CSRF-Token.
  res.cookie(COOKIE.csrf, randomToken(24), {
    ...base,
    httpOnly: false,
    path: '/',
    expires: t.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  const base = {
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
  res.clearCookie(COOKIE.access, { ...base, path: '/api' });
  res.clearCookie(COOKIE.refresh, { ...base, path: '/api/v1/auth' });
  res.clearCookie(COOKIE.csrf, { ...base, path: '/' });
}
