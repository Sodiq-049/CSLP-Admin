import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Types, type Model } from 'mongoose';
import type { AccountType } from '@cslp/shared-types';
import { AppError, MODELS, type AuthSessionDoc } from '@cslp/server-core';
import { randomToken, sha256 } from './crypto.js';
import { SESSION_POLICY } from './auth.types.js';

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Refresh-token families (docs/02 §3, docs/03 §6). Each refresh rotates the token; presenting a
 * previously-rotated token is treated as theft and revokes the entire family.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  constructor(@InjectModel(MODELS.AuthSession) private readonly sessions: Model<AuthSessionDoc>) {}

  async create(input: {
    userId: string;
    audience: AccountType;
    mfaSatisfied: boolean;
    ip: string | null;
    userAgent: string | null;
  }): Promise<IssuedSession> {
    const policy = SESSION_POLICY[input.audience];
    const now = new Date();
    const refreshToken = randomToken();
    const doc = await this.sessions.create({
      userId: new Types.ObjectId(input.userId),
      familyId: randomUUID(),
      currentTokenHash: sha256(refreshToken),
      audience: input.audience,
      mfaSatisfiedAt: input.mfaSatisfied ? now : null,
      authTime: now,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + policy.idleSec * 1000),
      expiresAt: new Date(now.getTime() + policy.absoluteSec * 1000),
    });
    return { sessionId: String(doc._id), refreshToken, refreshExpiresAt: doc.expiresAt };
  }

  async rotate(
    refreshToken: string,
    ip: string | null,
  ): Promise<IssuedSession & { userId: string; audience: AccountType }> {
    const hash = sha256(refreshToken);
    const now = new Date();
    const session = await this.sessions.findOne({ currentTokenHash: hash }).lean<AuthSessionDoc>();
    if (!session) {
      const reused = await this.sessions
        .findOne({ previousTokenHashes: hash })
        .lean<AuthSessionDoc>();
      if (reused && !reused.revokedAt) {
        await this.revoke(String(reused._id), 'refresh_token_reuse');
        this.logger.warn(
          { sessionId: String(reused._id), userId: String(reused.userId), ip },
          'Refresh token reuse detected; family revoked',
        );
      }
      throw new AppError('UNAUTHENTICATED', 'Session expired, please sign in again');
    }
    if (session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now) {
      throw new AppError('UNAUTHENTICATED', 'Session expired, please sign in again');
    }
    const policy = SESSION_POLICY[session.audience];
    const next = randomToken();
    // Conditional update guards against two concurrent refreshes of the same token.
    const updated = await this.sessions.findOneAndUpdate(
      { _id: session._id, currentTokenHash: hash, revokedAt: null },
      {
        $set: {
          currentTokenHash: sha256(next),
          lastUsedAt: now,
          idleExpiresAt: new Date(
            Math.min(now.getTime() + policy.idleSec * 1000, session.expiresAt.getTime()),
          ),
          ip,
        },
        $push: { previousTokenHashes: { $each: [hash], $slice: -5 } },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new AppError('UNAUTHENTICATED', 'Session expired, please sign in again');
    return {
      sessionId: String(session._id),
      refreshToken: next,
      refreshExpiresAt: session.expiresAt,
      userId: String(session.userId),
      audience: session.audience,
    };
  }

  async findActive(sessionId: string): Promise<AuthSessionDoc | null> {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const now = new Date();
    return this.sessions
      .findOne({
        _id: sessionId,
        revokedAt: null,
        expiresAt: { $gt: now },
        idleExpiresAt: { $gt: now },
      })
      .lean<AuthSessionDoc>();
  }

  async markMfaSatisfied(sessionId: string): Promise<void> {
    await this.sessions.updateOne({ _id: sessionId }, { $set: { mfaSatisfiedAt: new Date() } });
  }

  async touchAuthTime(sessionId: string): Promise<void> {
    await this.sessions.updateOne({ _id: sessionId }, { $set: { authTime: new Date() } });
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    await revokeByRefreshToken(this.sessions, refreshToken);
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.sessions.updateOne(
      { _id: sessionId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: reason } },
    );
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<void> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), revokedAt: null };
    if (exceptSessionId) filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
    await this.sessions.updateMany(filter, {
      $set: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async listForUser(userId: string): Promise<AuthSessionDoc[]> {
    return this.sessions
      .find({ userId: new Types.ObjectId(userId), revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .lean<AuthSessionDoc[]>();
  }

  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const r = await this.sessions.updateOne(
      { _id: sessionId, userId: new Types.ObjectId(userId), revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: 'user_revoked' } },
    );
    if (r.matchedCount === 0) throw AppError.notFound('Session');
  }
}

export async function revokeByRefreshToken(
  sessions: Model<AuthSessionDoc>,
  refreshToken: string,
): Promise<void> {
  await sessions.updateOne(
    { currentTokenHash: sha256(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: 'logout' } },
  );
}
