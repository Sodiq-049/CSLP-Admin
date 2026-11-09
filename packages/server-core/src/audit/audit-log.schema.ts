import { Schema, Types } from 'mongoose';

export interface AuditLogDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId | null;
  actorId: Types.ObjectId | null;
  actorRoles: string[];
  action: string;
  target: { type: string; id: string | null };
  before: unknown;
  after: unknown;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

/** Append-only (docs/02 §10). Production DB user gets insert/find only on this collection. */
export const auditLogSchema = new Schema<AuditLogDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, default: null },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorRoles: { type: [String], default: [] },
    action: { type: String, required: true },
    target: { type: { type: String, required: true }, id: { type: String, default: null } },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false, strict: 'throw' },
);
auditLogSchema.index({ institutionId: 1, at: -1 });
auditLogSchema.index({ 'target.type': 1, 'target.id': 1, at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });
