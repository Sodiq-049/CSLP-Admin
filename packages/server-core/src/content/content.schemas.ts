import { Schema, Types } from 'mongoose';
import {
  DISPLAY_STATUSES,
  GENERATION_STATUSES,
  MATERIAL_KINDS,
  PUBLICATION_STATES,
  REVIEW_STATUSES,
  type DisplayStatus,
  type GenerationStatus,
  type MaterialKind,
  type PublicationState,
  type ReviewStatus,
} from '@cslp/shared-types';
import { baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

/* ───────── learning materials: lifecycle pointers (docs/02 §5) ───────── */
export interface LearningMaterialDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId;
  topicId: Types.ObjectId;
  kind: MaterialKind;
  locale: string;
  title: string;
  currentDraftVersionId: Types.ObjectId | null;
  latestApprovedVersionId: Types.ObjectId | null;
  publishedVersionId: Types.ObjectId | null;
  publication: {
    state: PublicationState;
    publishedAt: Date | null;
    publishedBy: Types.ObjectId | null;
    scheduledFor: Date | null;
    scheduledVersionId: Types.ObjectId | null;
    unpublishedAt: Date | null;
  };
  displayStatus: DisplayStatus;
  createdAt: Date;
  updatedAt: Date;
}
export const learningMaterialSchema = new Schema<LearningMaterialDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    topicId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: MATERIAL_KINDS, required: true },
    locale: { type: String, default: 'en-NG' },
    title: { type: String, required: true },
    currentDraftVersionId: { type: Schema.Types.ObjectId, default: null },
    latestApprovedVersionId: { type: Schema.Types.ObjectId, default: null },
    publishedVersionId: { type: Schema.Types.ObjectId, default: null },
    publication: {
      state: { type: String, enum: PUBLICATION_STATES, default: 'unpublished' },
      publishedAt: { type: Date, default: null },
      publishedBy: { type: Schema.Types.ObjectId, default: null },
      scheduledFor: { type: Date, default: null },
      scheduledVersionId: { type: Schema.Types.ObjectId, default: null },
      unpublishedAt: { type: Date, default: null },
    },
    displayStatus: { type: String, enum: DISPLAY_STATUSES, default: 'draft' },
  },
  baseSchemaOptions,
);
learningMaterialSchema.index(
  { institutionId: 1, topicId: 1, kind: 1, locale: 1 },
  { unique: true, partialFilterExpression: { kind: { $ne: 'resource' } } },
);
learningMaterialSchema.index({ institutionId: 1, courseId: 1, displayStatus: 1 });
learningMaterialSchema.plugin(tenantScopedPlugin);

/* ───────── content versions: immutable once submitted (docs/05 §4) ───────── */
export interface CitationDoc {
  label: string;
  index: number;
  sourceDocumentId: Types.ObjectId;
  sourceTitle: string;
  chunkId: Types.ObjectId;
  page: number | null;
  quote: string;
}
export interface ContentVersionDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  materialId: Types.ObjectId;
  courseId: Types.ObjectId;
  topicId: Types.ObjectId;
  kind: MaterialKind;
  versionNumber: number;
  parentVersionId: Types.ObjectId | null;
  origin: 'ai_generated' | 'manual' | 'ai_assisted_edit';
  generationStatus: GenerationStatus;
  reviewStatus: ReviewStatus;
  frozenAt: Date | null;
  body: Record<string, unknown> | null;
  provenance: {
    citations: CitationDoc[];
    insufficientSources: boolean;
    missingTopics: string[];
    warnings: string[];
  };
  generation: {
    provider: string;
    model: string;
    taskKey: string;
    promptVersion: string;
    jobId: Types.ObjectId | null;
    options: Record<string, unknown>;
    error: string | null;
  } | null;
  contentHash: string | null;
  autosaveRev: number;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  submittedBy: Types.ObjectId | null;
  submittedAt: Date | null;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export const contentVersionSchema = new Schema<ContentVersionDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    topicId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: MATERIAL_KINDS, required: true },
    versionNumber: { type: Number, required: true },
    parentVersionId: { type: Schema.Types.ObjectId, default: null },
    origin: { type: String, enum: ['ai_generated', 'manual', 'ai_assisted_edit'], required: true },
    generationStatus: { type: String, enum: GENERATION_STATUSES, default: 'none' },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'draft' },
    frozenAt: { type: Date, default: null },
    body: { type: Schema.Types.Mixed, default: null },
    provenance: {
      citations: { type: [Schema.Types.Mixed], default: [] },
      insufficientSources: { type: Boolean, default: false },
      missingTopics: { type: [String], default: [] },
      warnings: { type: [String], default: [] },
    },
    generation: { type: Schema.Types.Mixed, default: null },
    contentHash: { type: String, default: null },
    autosaveRev: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    submittedBy: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
contentVersionSchema.index(
  { institutionId: 1, materialId: 1, versionNumber: -1 },
  { unique: true },
);
contentVersionSchema.index({ institutionId: 1, reviewStatus: 1, submittedAt: 1 });
contentVersionSchema.plugin(tenantScopedPlugin);
// Second safety net behind the service layer: frozen versions never change body (docs/05 §4.3).
for (const op of ['updateOne', 'findOneAndUpdate', 'updateMany'] as const) {
  contentVersionSchema.pre(op, function () {
    const q = this as unknown as {
      getFilter(): Record<string, unknown>;
      getUpdate(): Record<string, Record<string, unknown>> | null;
    };
    const update = q.getUpdate() ?? {};
    const touchesBody = Object.keys(update.$set ?? {}).some(
      (k) => k === 'body' || k.startsWith('body.'),
    );
    if (touchesBody && q.getFilter().frozenAt !== null)
      throw new Error(
        'Refusing to change the body of a possibly frozen version: filter must include frozenAt: null',
      );
  });
}

/* ───────── reviews ───────── */
export interface ContentReviewDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  versionId: Types.ObjectId;
  materialId: Types.ObjectId;
  reviewerId: Types.ObjectId;
  decision: 'approved' | 'changes_requested' | 'rejected';
  comment: string;
  checklist: {
    accuracy: boolean;
    objectivesCovered: boolean;
    citationsChecked: boolean;
    appropriateLevel: boolean;
  };
  createdAt: Date;
}
export const contentReviewSchema = new Schema<ContentReviewDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    reviewerId: { type: Schema.Types.ObjectId, required: true },
    decision: { type: String, enum: ['approved', 'changes_requested', 'rejected'], required: true },
    comment: { type: String, default: '' },
    checklist: {
      accuracy: Boolean,
      objectivesCovered: Boolean,
      citationsChecked: Boolean,
      appropriateLevel: Boolean,
    },
  },
  baseSchemaOptions,
);
contentReviewSchema.index({ institutionId: 1, versionId: 1, createdAt: -1 });
contentReviewSchema.plugin(tenantScopedPlugin);
