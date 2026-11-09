import { Inject, Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { decrypt, encrypt, randomToken, sha256 } from './crypto.js';

const PERIOD = 30;

@Injectable()
export class MfaService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private totp(secretB32: string, label: string) {
    return new OTPAuth.TOTP({
      issuer: 'CSLP Admin',
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD,
      secret: OTPAuth.Secret.fromBase32(secretB32),
    });
  }

  createSecret(label: string): { secretB32: string; otpauthUrl: string; encrypted: string } {
    const secretB32 = new OTPAuth.Secret({ size: 20 }).base32;
    return {
      secretB32,
      otpauthUrl: this.totp(secretB32, label).toString(),
      encrypted: encrypt(secretB32, this.config.MFA_ENCRYPTION_KEY),
    };
  }

  /**
   * Returns the TOTP time-step that matched, or null. Callers persist the step and reject codes
   * at or before the last used step (replay protection).
   */
  verify(encryptedSecret: string, code: string, lastUsedStep: number | null): number | null {
    const secretB32 = decrypt(encryptedSecret, this.config.MFA_ENCRYPTION_KEY);
    const delta = this.totp(secretB32, 'verify').validate({
      token: code.replace(/\s/g, ''),
      window: 1,
    });
    if (delta === null) return null;
    const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
    if (lastUsedStep !== null && step <= lastUsedStep) return null;
    return step;
  }

  /** Test/dev helper: the current code for a secret. */
  currentCode(encryptedSecret: string): string {
    return this.totp(decrypt(encryptedSecret, this.config.MFA_ENCRYPTION_KEY), 'x').generate();
  }

  generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
    const plain = Array.from({ length: 10 }, () => {
      const t = randomToken(8)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 10)
        .toUpperCase()
        .padEnd(10, 'X');
      return `${t.slice(0, 5)}-${t.slice(5)}`;
    });
    return { plain, hashes: plain.map((c) => sha256(c)) };
  }
}
