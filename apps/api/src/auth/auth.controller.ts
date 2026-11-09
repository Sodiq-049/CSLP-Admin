import { Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AcceptInvitationRequestSchema,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
  MfaConfirmRequestSchema,
  MfaConfirmResponseSchema,
  MfaEnrolRequestSchema,
  MfaEnrolResponseSchema,
  MfaVerifyRequestSchema,
  OkSchema,
  ReauthenticateRequestSchema,
  RefreshRequestSchema,
  SessionSchema,
  type LoginResponse,
} from '@cslp/validation';
import { AppError } from '@cslp/server-core';
import type { AccountType } from '@cslp/shared-types';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import type { AppRequest } from '../common/http.js';
import { ApiOk, IdParam, ZodBody } from '../common/zod.js';
import { AuthService, type ClientInfo } from './auth.service.js';
import { clearAuthCookies, setAuthCookies } from './cookies.js';
import { COOKIE, type AuthContext } from './auth.types.js';
import { AllowWithoutMfa, CurrentAuth, Public } from './decorators.js';
import type { IssuedSession } from './session.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

const client = (req: AppRequest): ClientInfo => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});
const wantsTokens = (req: AppRequest) => req.get('x-auth-mode') === 'token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Issue access token for a session; cookies for browsers, body for token-mode clients. */
  private issue(
    req: AppRequest,
    res: Response,
    userId: string,
    audience: AccountType,
    s: IssuedSession,
  ): LoginResponse {
    const access = this.tokens.signAccess(userId, s.sessionId, audience);
    if (wantsTokens(req)) {
      return {
        status: 'authenticated',
        tokens: {
          accessToken: access.token,
          refreshToken: s.refreshToken,
          expiresIn: access.expiresIn,
        },
      };
    }
    setAuthCookies(res, this.config, {
      accessToken: access.token,
      accessTtlSec: access.expiresIn,
      refreshToken: s.refreshToken,
      refreshExpiresAt: s.refreshExpiresAt,
    });
    return { status: 'authenticated' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOk(LoginResponseSchema)
  async login(
    @ZodBody(LoginRequestSchema) body: z.output<typeof LoginRequestSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.login(body.email, body.password, client(req));
    if (r.status !== 'authenticated') return r;
    return this.issue(req, res, r.userId, r.audience, r.session);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verify')
  @ApiOk(LoginResponseSchema)
  async verifyMfa(
    @ZodBody(MfaVerifyRequestSchema) body: z.output<typeof MfaVerifyRequestSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const r = await this.auth.verifyMfaLogin(body.mfaToken, body.code, client(req));
    return this.issue(req, res, r.userId, r.audience, r.session);
  }

  /** Public so it works mid-login (with mfaToken) or from an authenticated session. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/enrol')
  @ApiOk(MfaEnrolResponseSchema)
  enrol(
    @ZodBody(MfaEnrolRequestSchema) body: z.output<typeof MfaEnrolRequestSchema>,
    @Req() req: AppRequest,
  ) {
    return this.auth.startEnrolment(req.auth, body.mfaToken);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/confirm')
  @ApiOk(MfaConfirmResponseSchema)
  async confirm(
    @ZodBody(MfaConfirmRequestSchema) body: z.output<typeof MfaConfirmRequestSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.auth.confirmEnrolment(req.auth, body.code, client(req), body.mfaToken);
    if (r.session) this.issue(req, res, r.userId, r.audience, r.session);
    return { recoveryCodes: r.recoveryCodes };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @ApiOk(LoginResponseSchema)
  async refresh(
    @ZodBody(RefreshRequestSchema) body: z.output<typeof RefreshRequestSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const token = body.refreshToken ?? (req.cookies?.[COOKIE.refresh] as string | undefined);
    if (!token) throw new AppError('UNAUTHENTICATED', 'No session');
    try {
      const r = await this.sessions.rotate(token, req.ip ?? null);
      return this.issue(req, res, r.userId, r.audience, r);
    } catch (err) {
      if (!body.refreshToken) clearAuthCookies(res, this.config);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @ApiOk(OkSchema)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (req.auth) await this.sessions.revoke(req.auth.sessionId, 'logout');
    const rt = req.cookies?.[COOKIE.refresh] as string | undefined;
    if (rt) await this.sessions.revokeByRefreshToken(rt);
    clearAuthCookies(res, this.config);
    return { ok: true as const };
  }

  @AllowWithoutMfa()
  @Get('me')
  @ApiOk(MeResponseSchema)
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Post('reauthenticate')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOk(OkSchema)
  async reauthenticate(
    @ZodBody(ReauthenticateRequestSchema) body: z.output<typeof ReauthenticateRequestSchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    await this.auth.reauthenticate(auth, body.password, body.code);
    return { ok: true as const };
  }

  @Get('sessions')
  @ApiOk(SessionSchema, { list: true })
  sessionsList(@CurrentAuth() auth: AuthContext) {
    return this.auth.listSessions(auth);
  }

  @Delete('sessions/:id')
  @ApiOk(OkSchema)
  async revokeSession(@IdParam() id: string, @CurrentAuth() auth: AuthContext) {
    await this.sessions.revokeOwn(auth.userId, id);
    return { ok: true as const };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('invitations/:token/accept')
  @ApiOk(OkSchema)
  async acceptInvitation(
    @Param('token') token: string,
    @ZodBody(AcceptInvitationRequestSchema) body: z.output<typeof AcceptInvitationRequestSchema>,
    @Req() req: AppRequest,
  ) {
    await this.auth.acceptInvitation(token, body, client(req));
    return { ok: true as const };
  }

  @Post('password/change')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOk(OkSchema)
  async changePassword(
    @ZodBody(ChangePasswordRequestSchema) body: z.output<typeof ChangePasswordRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AppRequest,
  ) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword, client(req));
    return { ok: true as const };
  }
}
