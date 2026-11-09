import type { AccountType, Role } from '@cslp/shared-types';
import type { EffectivePermissions } from '@cslp/server-core';

export interface AuthContext {
  userId: string;
  email: string;
  accountType: AccountType;
  sessionId: string;
  authTime: Date;
  mfaSatisfied: boolean;
  via: 'cookie' | 'bearer';
  roles: Role[];
  assignments: { id: string; role: Role; institutionId: string | null; departmentIds: string[] }[];
  permissions: EffectivePermissions;
}

export const COOKIE = {
  access: 'cslp_at',
  refresh: 'cslp_rt',
  csrf: 'cslp_csrf',
} as const;

export const SESSION_POLICY = {
  admin: { accessTtlSec: 10 * 60, idleSec: 2 * 3600, absoluteSec: 12 * 3600 },
  student: { accessTtlSec: 15 * 60, idleSec: 30 * 86400, absoluteSec: 30 * 86400 },
} as const;

export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;
export const LOCKOUT = { maxFailures: 5, lockMs: 15 * 60 * 1000 } as const;
