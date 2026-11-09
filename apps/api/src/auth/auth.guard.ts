import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@cslp/server-core';
import type { AppRequest } from '../common/http.js';
import { AuthService } from './auth.service.js';
import { COOKIE, type AuthContext } from './auth.types.js';
import { safeEqual } from './crypto.js';
import { ALLOW_WITHOUT_MFA, IS_PUBLIC, RECENT_AUTH } from './decorators.js';
import { TokenService } from './token.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global authentication guard (docs/01 §5 step 3). Routes are private unless marked @Public().
 * Enforces: valid access token + live session, admin-only namespace, MFA, CSRF, recent auth.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.meta<boolean>(IS_PUBLIC, ctx) ?? false;
    const auth = await this.authenticate(req);

    if (isPublic) {
      if (auth) req.auth = auth; // optional auth on public routes (e.g. MFA enrolment)
      return true;
    }
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const isAdminRoute = (req.baseUrl + req.path).startsWith('/api/v1/admin');
    if (isAdminRoute && auth.accountType !== 'admin') throw AppError.forbidden();

    if (
      this.auth.requiresMfaFor(auth) &&
      !auth.mfaSatisfied &&
      !this.meta<boolean>(ALLOW_WITHOUT_MFA, ctx)
    ) {
      throw new AppError('MFA_REQUIRED', 'Multi-factor authentication is required for your role');
    }

    if (auth.via === 'cookie' && !SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token') ?? '';
      const cookie = (req.cookies?.[COOKIE.csrf] as string | undefined) ?? '';
      if (!header || !cookie || !safeEqual(header, cookie))
        throw new AppError('FORBIDDEN', 'Invalid CSRF token');
    }

    if (this.meta<boolean>(RECENT_AUTH, ctx) && !this.auth.isRecent(auth)) {
      throw new AppError('RECENT_AUTH_REQUIRED', 'Please confirm your password to continue');
    }

    req.auth = auth;
    return true;
  }

  private async authenticate(req: AppRequest): Promise<AuthContext | null> {
    const header = req.get('authorization');
    let token: string | undefined;
    let via: AuthContext['via'] = 'cookie';
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
      via = 'bearer';
    } else {
      token = req.cookies?.[COOKIE.access] as string | undefined;
    }
    if (!token) return null;
    const claims = this.tokens.verifyAccess(token);
    if (!claims) return null;
    const ctx = await this.auth.buildContext(claims.sub, claims.sid, via);
    if (!ctx || ctx.accountType !== claims.aud) return null;
    return ctx;
  }
}
