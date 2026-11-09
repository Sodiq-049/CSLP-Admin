import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccountType } from '@cslp/shared-types';
import { AppError } from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { SESSION_POLICY } from './auth.types.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  aud: AccountType;
  typ: 'access';
}
interface MfaClaims {
  sub: string;
  typ: 'mfa';
  purpose: 'verify' | 'enrol';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  signAccess(
    userId: string,
    sessionId: string,
    audience: AccountType,
  ): { token: string; expiresIn: number } {
    const expiresIn = SESSION_POLICY[audience].accessTtlSec;
    const token = this.jwt.sign(
      { sub: userId, sid: sessionId, typ: 'access' },
      {
        secret: this.config.JWT_ACCESS_SECRET,
        expiresIn,
        audience,
        issuer: 'cslp-api',
        algorithm: 'HS256',
      },
    );
    return { token, expiresIn };
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      const c = this.jwt.verify<AccessClaims & { aud: string }>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        issuer: 'cslp-api',
        algorithms: ['HS256'],
      });
      if (c.typ !== 'access' || (c.aud !== 'admin' && c.aud !== 'student')) return null;
      return c;
    } catch {
      return null;
    }
  }

  /** Short-lived token bridging password → MFA step. Separate secret derivation via `typ`. */
  signMfa(userId: string, purpose: MfaClaims['purpose']): string {
    return this.jwt.sign(
      { sub: userId, typ: 'mfa', purpose },
      {
        secret: this.config.JWT_ACCESS_SECRET,
        expiresIn: 5 * 60,
        issuer: 'cslp-api',
        audience: 'mfa',
      },
    );
  }

  verifyMfa(token: string, purpose?: MfaClaims['purpose']): MfaClaims {
    try {
      const c = this.jwt.verify<MfaClaims>(token, {
        secret: this.config.JWT_ACCESS_SECRET,
        issuer: 'cslp-api',
        audience: 'mfa',
        algorithms: ['HS256'],
      });
      if (c.typ !== 'mfa' || (purpose && c.purpose !== purpose)) throw new Error('wrong token');
      return c;
    } catch {
      throw new AppError('UNAUTHENTICATED', 'MFA step expired, please sign in again');
    }
  }
}
