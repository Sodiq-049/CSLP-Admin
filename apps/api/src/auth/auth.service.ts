import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { MFA_REQUIRED_ROLES, type AccountType, type Role } from '@cslp/shared-types';
import type { AcceptInvitationRequest, MeResponse, Session } from '@cslp/validation';
import {
  AppError,
  AuditLogService,
  EffectivePermissions,
  hashPassword,
  MODELS,
  verifyPassword,
  type Actor,
  type InstitutionDoc,
  type InvitationDoc,
  type RoleAssignmentDoc,
  type UserDoc,
} from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MfaService } from './mfa.service.js';
import { SessionService, type IssuedSession } from './session.service.js';
import { TokenService } from './token.service.js';
import { sha256 } from './crypto.js';
import { LOCKOUT, RECENT_AUTH_WINDOW_MS, type AuthContext } from './auth.types.js';

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export type LoginOutcome =
  | { status: 'authenticated'; session: IssuedSession; userId: string; audience: AccountType }
  | { status: 'mfa_required'; mfaToken: string }
  | { status: 'mfa_enrolment_required'; mfaToken: string };

const INVALID = () => new AppError('UNAUTHENTICATED', 'Invalid email or password');

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    @InjectModel(MODELS.RoleAssignment) private readonly assignments: Model<RoleAssignmentDoc>,
    @InjectModel(MODELS.Invitation) private readonly invitations: Model<InvitationDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly audit: AuditLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async activeAssignments(userId: string): Promise<RoleAssignmentDoc[]> {
    return this.assignments
      .find({ userId: new Types.ObjectId(userId), revokedAt: null })
      .lean<RoleAssignmentDoc[]>();
  }

  /** Only when MFA_REQUIRED is on; otherwise users who enabled MFA are still asked for their code. */
  private requiresMfa(roles: Role[]): boolean {
    if (!this.config.MFA_REQUIRED) return false;
    return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
  }

  /* ───────────── login ───────────── */

  async login(email: string, password: string, client: ClientInfo): Promise<LoginOutcome> {
    const user = await this.users
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .lean<UserDoc>();

    if (!user) {
      await verifyPassword(null, password);
      throw INVALID();
    }
    if (user.security.lockedUntil && user.security.lockedUntil > new Date()) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Account temporarily locked after repeated failed sign-ins. Try again later.',
      );
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      await this.recordFailure(user, client);
      throw INVALID();
    }
    if (user.status !== 'active') throw INVALID();
    // Only revealed after the correct password, so this can't be used to probe for accounts.
    if (user.accountType === 'student' && !user.emailVerifiedAt)
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address first. Check your inbox for the link.',
      );

    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          'security.failedLoginCount': 0,
          'security.lockedUntil': null,
          'security.lastLoginAt': new Date(),
          'security.lastLoginIp': client.ip,
        },
      },
    );

    const roles = (await this.activeAssignments(String(user._id))).map((a) => a.role);
    if (user.accountType === 'admin' && roles.length === 0) throw INVALID();

    if (user.mfa.enabled)
      return { status: 'mfa_required', mfaToken: this.tokens.signMfa(String(user._id), 'verify') };
    if (user.accountType === 'admin' && this.requiresMfa(roles)) {
      return {
        status: 'mfa_enrolment_required',
        mfaToken: this.tokens.signMfa(String(user._id), 'enrol'),
      };
    }
    const session = await this.sessions.create({
      userId: String(user._id),
      audience: user.accountType,
      mfaSatisfied: false,
      ...client,
    });
    await this.audit.record({
      actor: this.actorFor(user, client),
      action: 'auth.login',
      target: { type: 'user', id: user._id },
    });
    return {
      status: 'authenticated',
      session,
      userId: String(user._id),
      audience: user.accountType,
    };
  }

  private async recordFailure(user: UserDoc, client: ClientInfo) {
    const failures = user.security.failedLoginCount + 1;
    const lock = failures >= LOCKOUT.maxFailures;
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          'security.failedLoginCount': lock ? 0 : failures,
          ...(lock ? { 'security.lockedUntil': new Date(Date.now() + LOCKOUT.lockMs) } : {}),
        },
      },
    );
    await this.audit.record({
      actor: this.actorFor(user, client),
      action: lock ? 'auth.lockout' : 'auth.login_failed',
      target: { type: 'user', id: user._id },
    });
  }

  private actorFor(user: UserDoc, client: ClientInfo): Actor {
    return { userId: String(user._id), roles: [], ip: client.ip, userAgent: client.userAgent };
  }

  /* ───────────── MFA ───────────── */

  async verifyMfaLogin(mfaToken: string, code: string, client: ClientInfo) {
    const { sub } = this.tokens.verifyMfa(mfaToken, 'verify');
    const user = await this.loadWithMfaSecrets(sub);
    if (!user.mfa.enabled || !user.mfa.totpSecretEnc)
      throw new AppError('UNAUTHENTICATED', 'MFA is not enabled');
    await this.checkSecondFactor(user, code);
    const session = await this.sessions.create({
      userId: sub,
      audience: user.accountType,
      mfaSatisfied: true,
      ...client,
    });
    await this.audit.record({
      actor: this.actorFor(user, client),
      action: 'auth.login',
      target: { type: 'user', id: sub },
    });
    return { session, userId: sub, audience: user.accountType };
  }

  /** TOTP (with replay protection) or a one-time recovery code. */
  private async checkSecondFactor(user: UserDoc, code: string): Promise<void> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const step = this.mfa.verify(user.mfa.totpSecretEnc!, trimmed, user.mfa.lastUsedStep);
      if (step === null) throw new AppError('UNAUTHENTICATED', 'Invalid verification code');
      await this.users.updateOne({ _id: user._id }, { $set: { 'mfa.lastUsedStep': step } });
      return;
    }
    const hash = sha256(trimmed.toUpperCase());
    const r = await this.users.updateOne(
      { _id: user._id, 'mfa.recoveryCodeHashes': hash },
      { $pull: { 'mfa.recoveryCodeHashes': hash } },
    );
    if (r.modifiedCount === 0) throw new AppError('UNAUTHENTICATED', 'Invalid verification code');
  }

  private async loadWithMfaSecrets(userId: string): Promise<UserDoc> {
    const user = await this.users
      .findById(userId)
      .select(
        '+mfa.totpSecretEnc +mfa.pendingSecretEnc +mfa.recoveryCodeHashes +mfa.lastUsedStep +passwordHash',
      )
      .lean<UserDoc>();
    if (!user || user.status !== 'active')
      throw new AppError('UNAUTHENTICATED', 'Please sign in again');
    return user;
  }

  /** Resolve who is enrolling: an authenticated session, or an enrolment mfaToken from login. */
  private resolveEnrollee(auth: AuthContext | undefined, mfaToken?: string): string {
    if (mfaToken) return this.tokens.verifyMfa(mfaToken, 'enrol').sub;
    if (auth) return auth.userId;
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }

  async startEnrolment(auth: AuthContext | undefined, mfaToken?: string) {
    const userId = this.resolveEnrollee(auth, mfaToken);
    const user = await this.loadWithMfaSecrets(userId);
    if (user.mfa.enabled) throw AppError.conflict('MFA is already enabled');
    const s = this.mfa.createSecret(user.email);
    await this.users.updateOne(
      { _id: user._id },
      { $set: { 'mfa.pendingSecretEnc': s.encrypted } },
    );
    return { otpauthUrl: s.otpauthUrl, secret: s.secretB32 };
  }

  async confirmEnrolment(
    auth: AuthContext | undefined,
    code: string,
    client: ClientInfo,
    mfaToken?: string,
  ) {
    const userId = this.resolveEnrollee(auth, mfaToken);
    const user = await this.loadWithMfaSecrets(userId);
    if (!user.mfa.pendingSecretEnc) throw AppError.conflict('Start MFA enrolment first');
    const step = this.mfa.verify(user.mfa.pendingSecretEnc, code, null);
    if (step === null)
      throw new AppError('VALIDATION_FAILED', 'Invalid verification code', [
        { path: 'code', issue: 'invalid' },
      ]);
    const recovery = this.mfa.generateRecoveryCodes();
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          'mfa.enabled': true,
          'mfa.totpSecretEnc': user.mfa.pendingSecretEnc,
          'mfa.pendingSecretEnc': null,
          'mfa.recoveryCodeHashes': recovery.hashes,
          'mfa.enrolledAt': new Date(),
          'mfa.lastUsedStep': step,
        },
      },
    );
    await this.audit.record({
      actor: { userId, roles: [], ...client },
      action: 'auth.mfa.enrolled',
      target: { type: 'user', id: userId },
    });

    let session: IssuedSession | undefined;
    if (auth) await this.sessions.markMfaSatisfied(auth.sessionId);
    else
      session = await this.sessions.create({
        userId,
        audience: user.accountType,
        mfaSatisfied: true,
        ...client,
      });
    return { recoveryCodes: recovery.plain, session, userId, audience: user.accountType };
  }

  async reauthenticate(auth: AuthContext, password: string, code?: string): Promise<void> {
    const user = await this.loadWithMfaSecrets(auth.userId);
    if (!(await verifyPassword(user.passwordHash, password)))
      throw new AppError('UNAUTHENTICATED', 'Invalid password');
    if (user.mfa.enabled) {
      if (!code) throw new AppError('MFA_REQUIRED', 'Verification code required');
      await this.checkSecondFactor(user, code);
    }
    await this.sessions.touchAuthTime(auth.sessionId);
  }

  isRecent(auth: AuthContext): boolean {
    return Date.now() - auth.authTime.getTime() <= RECENT_AUTH_WINDOW_MS;
  }

  /* ───────────── me / sessions ───────────── */

  async me(auth: AuthContext): Promise<MeResponse> {
    const user = await this.users.findById(auth.userId).lean<UserDoc>();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Please sign in again');
    const instIds = auth.assignments.map((a) => a.institutionId).filter((x): x is string => !!x);
    const insts = await this.institutions
      .find({ _id: { $in: instIds.map((i) => new Types.ObjectId(i)) } }, { name: 1 })
      .lean<InstitutionDoc[]>();
    const names = new Map(insts.map((i) => [String(i._id), i.name]));
    return {
      id: String(user._id),
      email: user.email,
      accountType: user.accountType,
      status: user.status,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      mfaEnabled: user.mfa.enabled,
      assignments: auth.assignments.map((a) => ({
        id: a.id,
        role: a.role,
        institutionId: a.institutionId,
        institutionName: a.institutionId ? (names.get(a.institutionId) ?? null) : null,
        departmentIds: a.departmentIds,
      })),
      permissions: auth.permissions.toJSON(),
    };
  }

  async listSessions(auth: AuthContext): Promise<Session[]> {
    const list = await this.sessions.listForUser(auth.userId);
    return list.map((s) => ({
      id: String(s._id),
      current: String(s._id) === auth.sessionId,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
    }));
  }

  /* ───────────── invitations / passwords ───────────── */

  async acceptInvitation(
    token: string,
    input: AcceptInvitationRequest,
    client: ClientInfo,
  ): Promise<void> {
    const inv = await this.invitations
      .findOneAndUpdate(
        { tokenHash: sha256(token), consumedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<InvitationDoc>();
    if (!inv) throw new AppError('NOT_FOUND', 'This invitation is invalid or has expired');
    const user = await this.users.findById(inv.userId).lean<UserDoc>();
    if (!user || user.status !== 'invited')
      throw new AppError('CONFLICT', 'This invitation has already been used');
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: await hashPassword(input.password),
          status: 'active',
          'profile.firstName': input.firstName,
          'profile.lastName': input.lastName,
          'security.passwordChangedAt': new Date(),
        },
      },
    );
    await this.audit.record({
      actor: { userId: String(user._id), roles: [], ...client },
      action: 'auth.invitation.accepted',
      target: { type: 'user', id: user._id },
      institutionId: inv.institutionId,
    });
  }

  async changePassword(
    auth: AuthContext,
    current: string,
    next: string,
    client: ClientInfo,
  ): Promise<void> {
    const user = await this.users.findById(auth.userId).select('+passwordHash').lean<UserDoc>();
    if (!user || !(await verifyPassword(user.passwordHash, current))) {
      throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', [
        { path: 'currentPassword', issue: 'invalid' },
      ]);
    }
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash: await hashPassword(next), 'security.passwordChangedAt': new Date() },
      },
    );
    await this.sessions.revokeAllForUser(auth.userId, 'password_changed', auth.sessionId);
    await this.audit.record({
      actor: { userId: auth.userId, roles: auth.roles, ...client },
      action: 'auth.password.changed',
      target: { type: 'user', id: auth.userId },
    });
  }

  /** Build the per-request context (used by AuthGuard). */
  async buildContext(
    userId: string,
    sessionId: string,
    via: AuthContext['via'],
  ): Promise<AuthContext | null> {
    const [session, user] = await Promise.all([
      this.sessions.findActive(sessionId),
      this.users.findById(userId).lean<UserDoc>(),
    ]);
    if (!session || !user || String(session.userId) !== userId || user.status !== 'active')
      return null;
    const assignments = await this.activeAssignments(userId);
    const mapped = assignments.map((a) => ({
      id: String(a._id),
      role: a.role,
      institutionId: a.institutionId ? String(a.institutionId) : null,
      departmentIds: a.departmentIds.map(String),
    }));
    return {
      userId,
      email: user.email,
      accountType: user.accountType,
      sessionId,
      authTime: session.authTime,
      mfaSatisfied: !!session.mfaSatisfiedAt,
      via,
      roles: [...new Set(mapped.map((a) => a.role))],
      assignments: mapped,
      permissions: EffectivePermissions.fromAssignments(mapped),
    };
  }

  requiresMfaFor(auth: AuthContext): boolean {
    return auth.accountType === 'admin' && this.requiresMfa(auth.roles);
  }
}
