import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import {
  AdminPasswordSchema,
  StudentPasswordSchema,
  type RegisterStudentSchema,
} from '@cslp/validation';
import {
  AppError,
  AuditLogService,
  hashPassword,
  MODELS,
  verifyPassword,
  type AcademicLevelDoc,
  type InstitutionDoc,
  type ProgrammeDoc,
  type TokenPurpose,
  type UserDoc,
  type VerificationTokenDoc,
} from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MAILER, type Mailer } from '../mail/mail.module.js';
import { randomToken, sha256 } from './crypto.js';
import { SessionService } from './session.service.js';
import type { ClientInfo } from './auth.service.js';

const TTL: Record<TokenPurpose, number> = {
  verify_email: 48 * 3600 * 1000,
  reset_password: 60 * 60 * 1000,
};
/** Minimum gap between emails of the same kind to one account (stops mail-bombing). */
const RESEND_GAP_MS = 60 * 1000;
const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

export const ACCEPTED_REGISTRATION =
  'If the details are valid, we have sent a verification link to that email address.';
export const ACCEPTED_RESET =
  'If an account exists for that email, we have sent a password reset link.';

/**
 * Self-service account flows (docs/03 §7). Every public entry point answers identically whether or
 * not the email exists, so these endpoints can't be used to discover accounts.
 * in
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  constructor(
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    @InjectModel(MODELS.VerificationToken) private readonly tokens: Model<VerificationTokenDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /* ───────────── registration ───────────── */

  async register(input: z.output<typeof RegisterStudentSchema>, client: ClientInfo): Promise<void> {
    const domains = this.config.STUDENT_EMAIL_DOMAINS;
    if (domains.length && !domains.includes(input.email.split('@')[1]!.toLowerCase())) {
      throw new AppError('VALIDATION_FAILED', 'Use your institution email address', [
        { path: 'email', issue: 'domain_not_allowed' },
      ]);
    }
    const inst = await this.institutions
      .findOne({ slug: input.institutionSlug, status: 'active', archivedAt: null })
      .lean<InstitutionDoc>();
    if (!inst)
      throw new AppError('VALIDATION_FAILED', 'Unknown institution', [
        { path: 'institutionSlug', issue: 'not_found' },
      ]);
    if (input.programmeId) {
      const ok = await this.programmes.exists({
        institutionId: inst._id,
        _id: oid(input.programmeId),
        archivedAt: null,
      });
      if (!ok)
        throw new AppError('VALIDATION_FAILED', 'Unknown programme', [
          { path: 'programmeId', issue: 'not_found' },
        ]);
    }
    if (input.levelId) {
      const ok = await this.levels.exists({
        institutionId: inst._id,
        _id: oid(input.levelId),
        archivedAt: null,
      });
      if (!ok)
        throw new AppError('VALIDATION_FAILED', 'Unknown level', [
          { path: 'levelId', issue: 'not_found' },
        ]);
    }

    const email = input.email.toLowerCase();
    const existing = await this.users.findOne({ email }).lean<UserDoc>();
    if (existing) {
      // Same response as a fresh signup. Unverified students get a new link; anyone else a notice.
      if (
        existing.accountType === 'student' &&
        !existing.emailVerifiedAt &&
        existing.status === 'active'
      ) {
        await this.sendVerification(existing);
      } else if (await this.mayEmail(existing._id, 'verify_email')) {
        await this.recordTokenlessSend(existing._id);
        await this.mailer.send({
          to: email,
          subject: 'Someone tried to register with your email',
          text: `Someone (hopefully you) tried to create a CSLP account with this email address, but an account already exists.\n\nIf you've forgotten your password, reset it here:\n${this.linkFor(existing, 'reset-password')}\n\nIf this wasn't you, you can ignore this email.\n`,
        });
      }
      await verifyPassword(null, input.password); // keep timing similar to the new-account path
      return;
    }

    let user: UserDoc;
    try {
      user = (
        await this.users.create({
          email,
          passwordHash: await hashPassword(input.password),
          accountType: 'student',
          status: 'active',
          profile: { firstName: input.firstName, lastName: input.lastName },
          emailVerifiedAt: null,
          studentProfile: {
            institutionId: inst._id,
            programmeId: input.programmeId ? oid(input.programmeId) : null,
            levelId: input.levelId ? oid(input.levelId) : null,
          },
        })
      ).toObject() as UserDoc;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return; // concurrent duplicate: same answer
      throw err;
    }
    await this.audit.record({
      actor: { userId: String(user._id), roles: [], ...client },
      action: 'student.registered',
      target: { type: 'user', id: user._id },
      institutionId: inst._id,
    });
    await this.sendVerification(user);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findOne({ email: email.toLowerCase() }).lean<UserDoc>();
    if (user && user.accountType === 'student' && !user.emailVerifiedAt && user.status === 'active')
      await this.sendVerification(user);
  }

  async verifyEmail(token: string, client: ClientInfo): Promise<void> {
    const t = await this.consume(token, 'verify_email');
    const user = await this.users.findById(t.userId).lean<UserDoc>();
    if (!user || user.status !== 'active') throw this.invalidLink();
    if (!user.emailVerifiedAt) {
      await this.users.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
      await this.audit.record({
        actor: { userId: String(user._id), roles: [], ...client },
        action: 'auth.email.verified',
        target: { type: 'user', id: user._id },
        institutionId: user.studentProfile?.institutionId ?? null,
      });
    }
  }

  /* ───────────── password reset ───────────── */

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findOne({ email: email.toLowerCase() }).lean<UserDoc>();
    if (!user || user.status !== 'active') return;
    if (!(await this.mayEmail(user._id, 'reset_password'))) return;
    const token = await this.issue(user._id, 'reset_password');
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your CSLP password',
      text: `We received a request to reset your password.\n\nChoose a new password (link valid for 1 hour):\n${this.linkFor(user, 'reset-password', token)}\n\nIf you didn't ask for this, you can ignore this email; your password won't change.\n`,
    });
  }

  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    const hash = sha256(token);
    const pending = await this.tokens
      .findOne({
        tokenHash: hash,
        purpose: 'reset_password',
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .lean<VerificationTokenDoc>();
    if (!pending) throw this.invalidLink();
    const user = await this.users.findById(pending.userId).lean<UserDoc>();
    if (!user || user.status !== 'active') throw this.invalidLink();
    // Validate against the account's own policy before spending the token.
    const policy = user.accountType === 'admin' ? AdminPasswordSchema : StudentPasswordSchema;
    const r = policy.safeParse(password);
    if (!r.success)
      throw new AppError(
        'VALIDATION_FAILED',
        r.error.issues[0]?.message ?? 'Password does not meet the policy',
        r.error.issues.map((i) => ({ path: 'password', issue: i.message })),
      );
    await this.consume(token, 'reset_password');
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: await hashPassword(password),
          'security.passwordChangedAt': new Date(),
          'security.failedLoginCount': 0,
          'security.lockedUntil': null,
          // Following an emailed link proves control of the inbox.
          ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }),
        },
      },
    );
    // Invalidate other outstanding reset links and every session.
    await this.tokens.updateMany(
      { userId: user._id, purpose: 'reset_password', consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );
    await this.sessions.revokeAllForUser(String(user._id), 'password_reset');
    await this.audit.record({
      actor: { userId: String(user._id), roles: [], ...client },
      action: 'auth.password.reset',
      target: { type: 'user', id: user._id },
      institutionId: user.studentProfile?.institutionId ?? null,
    });
  }

  /* ───────────── helpers ───────────── */

  private async sendVerification(user: UserDoc) {
    if (!(await this.mayEmail(user._id, 'verify_email'))) return;
    const token = await this.issue(user._id, 'verify_email');
    await this.mailer.send({
      to: user.email,
      subject: 'Verify your CSLP email address',
      text: `Welcome to CSLP, ${user.profile.firstName}!\n\nConfirm your email address to finish creating your account (link valid for 48 hours):\n${this.linkFor(user, 'verify-email', token)}\n\nIf you didn't create an account, you can ignore this email.\n`,
    });
  }

  private linkFor(user: UserDoc, path: 'verify-email' | 'reset-password', token?: string) {
    const base =
      user.accountType === 'admin' ? this.config.ADMIN_APP_URL : this.config.STUDENT_APP_URL;
    const url = new URL(`/${path}`, base);
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  private async mayEmail(userId: Types.ObjectId, purpose: TokenPurpose): Promise<boolean> {
    const recent = await this.tokens.exists({
      userId,
      purpose,
      createdAt: { $gt: new Date(Date.now() - RESEND_GAP_MS) },
    });
    if (recent)
      this.logger.warn({ userId: String(userId), purpose }, 'Email suppressed (sent recently)');
    return !recent;
  }

  /** Notices without a link still count toward the resend gap. */
  private async recordTokenlessSend(userId: Types.ObjectId) {
    await this.tokens.create({
      userId,
      purpose: 'verify_email',
      tokenHash: sha256(randomToken()),
      expiresAt: new Date(),
      consumedAt: new Date(),
    });
  }

  private async issue(userId: Types.ObjectId, purpose: TokenPurpose): Promise<string> {
    const token = randomToken();
    await this.tokens.create({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TTL[purpose]),
    });
    return token;
  }

  private async consume(token: string, purpose: TokenPurpose): Promise<VerificationTokenDoc> {
    const t = await this.tokens
      .findOneAndUpdate(
        { tokenHash: sha256(token), purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<VerificationTokenDoc>();
    if (!t) throw this.invalidLink();
    return t;
  }

  private invalidLink() {
    return new AppError('NOT_FOUND', 'This link is invalid or has expired');
  }
}
