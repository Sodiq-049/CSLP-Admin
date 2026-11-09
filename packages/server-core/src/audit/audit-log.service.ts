import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { MODELS } from '../database/model-names.js';
import type { AuditLogDoc } from './audit-log.schema.js';

/** Who is acting and from where — built by apps/api per request, by workers per job. */
export interface Actor {
  userId: string | null;
  roles: string[];
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null, roles: ['system'] };

const SECRET_KEYS = /password|secret|token|hash|recovery/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1),
    ]),
  );
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  constructor(@InjectModel(MODELS.AuditLog) private readonly model: Model<AuditLogDoc>) {}

  async record(entry: {
    actor: Actor;
    action: string;
    target: { type: string; id?: string | Types.ObjectId | null };
    institutionId?: string | Types.ObjectId | null;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    try {
      await this.model.create({
        institutionId: entry.institutionId ?? null,
        actorId: entry.actor.userId,
        actorRoles: entry.actor.roles,
        action: entry.action,
        target: { type: entry.target.type, id: entry.target.id ? String(entry.target.id) : null },
        before: redact(entry.before ?? null),
        after: redact(entry.after ?? null),
        requestId: entry.actor.requestId ?? null,
        ip: entry.actor.ip ?? null,
        userAgent: entry.actor.userAgent ?? null,
      });
    } catch (err) {
      // Auditing must never be silently lost; surface loudly but don't break the request.
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
