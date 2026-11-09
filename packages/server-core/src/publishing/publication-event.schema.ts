import { Schema, Types } from 'mongoose';
import { baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

export type PublicationAction =
  | 'publish'
  | 'schedule'
  | 'cancel_schedule'
  | 'unpublish'
  | 'rollback'
  | 'publish_course'
  | 'unpublish_course'
  | 'publish_topic'
  | 'unpublish_topic';

/** Append-only history of publishing decisions (docs/02 §5); drives rollback and the history tab. */
export interface PublicationEventDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId;
  action: PublicationAction;
  target: { type: 'material' | 'course' | 'topic'; id: Types.ObjectId };
  label: string;
  fromVersionId: Types.ObjectId | null;
  fromVersionNumber: number | null;
  toVersionId: Types.ObjectId | null;
  toVersionNumber: number | null;
  reason: string | null;
  bundleId: string | null;
  actorId: Types.ObjectId | null;
  createdAt: Date;
}
export const publicationEventSchema = new Schema<PublicationEventDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    target: {
      type: { type: String, required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },
    label: { type: String, required: true },
    fromVersionId: { type: Schema.Types.ObjectId, default: null },
    fromVersionNumber: { type: Number, default: null },
    toVersionId: { type: Schema.Types.ObjectId, default: null },
    toVersionNumber: { type: Number, default: null },
    reason: { type: String, default: null },
    bundleId: { type: String, default: null },
    actorId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
publicationEventSchema.index({ institutionId: 1, createdAt: -1 });
publicationEventSchema.index({ institutionId: 1, courseId: 1, createdAt: -1 });
publicationEventSchema.plugin(tenantScopedPlugin);
