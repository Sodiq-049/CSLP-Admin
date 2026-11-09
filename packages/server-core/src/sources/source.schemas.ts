import { Schema, Types } from 'mongoose';
import {
  JOB_STATUSES,
  JOB_TYPES,
  LICENCE_TYPES,
  PROCESSING_STATUSES,
  SOURCE_CATEGORIES,
  type JobStatus,
  type JobType,
  type LicenceType,
  type ProcessingStatus,
  type SourceCategory,
} from '@cslp/shared-types';
import { archivableFields, baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

/* ───────── media assets (metadata; bytes live in object storage) ───────── */
export interface MediaAssetDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  storageKey: string;
  bucket: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: 'document' | 'image' | 'audio' | 'video' | 'captions';
  visibility: 'private' | 'public_cdn';
  scanStatus: 'pending' | 'clean' | 'infected' | 'skipped';
  createdBy: Types.ObjectId | null;
  createdAt: Date;
}
export const mediaAssetSchema = new Schema<MediaAssetDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    storageKey: { type: String, required: true },
    bucket: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    kind: {
      type: String,
      enum: ['document', 'image', 'audio', 'video', 'captions'],
      required: true,
    },
    visibility: { type: String, enum: ['private', 'public_cdn'], default: 'private' },
    scanStatus: {
      type: String,
      enum: ['pending', 'clean', 'infected', 'skipped'],
      default: 'pending',
    },
    createdBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
mediaAssetSchema.index({ storageKey: 1 }, { unique: true });
mediaAssetSchema.index({ institutionId: 1, sha256: 1 });
mediaAssetSchema.plugin(tenantScopedPlugin);

/* ───────── source documents ───────── */
export interface SourceDocumentDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId | null;
  title: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  category: SourceCategory;
  licence: {
    type: LicenceType;
    notes: string | null;
    confirmedBy: Types.ObjectId | null;
    confirmedAt: Date;
  };
  assetId: Types.ObjectId;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  sha256: string;
  extractedTextKey: string | null;
  processing: {
    status: ProcessingStatus;
    jobId: Types.ObjectId | null;
    chunkCount: number;
    embedded: boolean;
    embeddingModel: string | null;
    error: string | null;
    warnings: string[];
  };
  approvedForGeneration: boolean;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
export const sourceDocumentSchema = new Schema<SourceDocumentDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true },
    authors: { type: [String], default: [] },
    publisher: { type: String, default: null },
    year: { type: Number, default: null },
    category: { type: String, enum: SOURCE_CATEGORIES, required: true },
    licence: {
      type: { type: String, enum: LICENCE_TYPES, required: true },
      notes: { type: String, default: null },
      confirmedBy: { type: Schema.Types.ObjectId, default: null },
      confirmedAt: { type: Date, required: true },
    },
    assetId: { type: Schema.Types.ObjectId, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    pageCount: { type: Number, default: null },
    sha256: { type: String, required: true },
    extractedTextKey: { type: String, default: null },
    processing: {
      status: { type: String, enum: PROCESSING_STATUSES, default: 'uploaded' },
      jobId: { type: Schema.Types.ObjectId, default: null },
      chunkCount: { type: Number, default: 0 },
      embedded: { type: Boolean, default: false },
      embeddingModel: { type: String, default: null },
      error: { type: String, default: null },
      warnings: { type: [String], default: [] },
    },
    approvedForGeneration: { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    ...archivableFields,
  },
  baseSchemaOptions,
);
sourceDocumentSchema.index({ institutionId: 1, courseId: 1, createdAt: -1 });
sourceDocumentSchema.index(
  { institutionId: 1, sha256: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);
sourceDocumentSchema.plugin(tenantScopedPlugin);

/* ───────── document chunks (RAG) ───────── */
export interface DocumentChunkDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId | null;
  sourceDocumentId: Types.ObjectId;
  ordinal: number;
  text: string;
  tokenCount: number;
  location: { page: number | null; headingPath: string[]; charStart: number; charEnd: number };
  embedding: number[] | null;
  embeddingModel: string | null;
}
export const documentChunkSchema = new Schema<DocumentChunkDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, default: null },
    sourceDocumentId: { type: Schema.Types.ObjectId, required: true },
    ordinal: { type: Number, required: true },
    text: { type: String, required: true },
    tokenCount: { type: Number, required: true },
    location: {
      page: { type: Number, default: null },
      headingPath: { type: [String], default: [] },
      charStart: Number,
      charEnd: Number,
    },
    embedding: { type: [Number], default: null, select: false },
    embeddingModel: { type: String, default: null },
  },
  { versionKey: false, strict: 'throw' },
);
documentChunkSchema.index({ institutionId: 1, sourceDocumentId: 1, ordinal: 1 }, { unique: true });
documentChunkSchema.plugin(tenantScopedPlugin);

/* ───────── generation jobs (all background work) ───────── */
export interface GenerationJobDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  type: JobType;
  status: JobStatus;
  dedupeKey: string;
  progress: { pct: number; stage: string; message: string | null };
  input: Record<string, unknown>;
  target: {
    sourceDocumentId: Types.ObjectId | null;
    outlineId: Types.ObjectId | null;
    courseId: Types.ObjectId | null;
  };
  attempts: number;
  maxAttempts: number;
  lastError: { code: string; message: string; retryable: boolean } | null;
  requestedBy: Types.ObjectId | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export const generationJobSchema = new Schema<GenerationJobDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: JOB_TYPES, required: true },
    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    dedupeKey: { type: String, required: true },
    progress: {
      pct: { type: Number, default: 0 },
      stage: { type: String, default: 'queued' },
      message: { type: String, default: null },
    },
    input: { type: Schema.Types.Mixed, default: {} },
    target: {
      sourceDocumentId: { type: Schema.Types.ObjectId, default: null },
      outlineId: { type: Schema.Types.ObjectId, default: null },
      courseId: { type: Schema.Types.ObjectId, default: null },
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    lastError: { type: Schema.Types.Mixed, default: null },
    requestedBy: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
// One active job per dedupe key (docs/06 §7).
generationJobSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['queued', 'active'] } } },
);
generationJobSchema.index({ institutionId: 1, status: 1, createdAt: -1 });
generationJobSchema.plugin(tenantScopedPlugin);

/* ───────── AI usage ledger (append-only) ───────── */
export interface AiUsageDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  jobId: Types.ObjectId | null;
  capability: 'text' | 'embedding';
  taskKey: string;
  provider: string;
  model: string;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  latencyMs: number;
  status: 'ok' | 'error';
  errorCode: string | null;
  at: Date;
}
export const aiUsageSchema = new Schema<AiUsageDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    jobId: { type: Schema.Types.ObjectId, default: null },
    capability: { type: String, enum: ['text', 'embedding'], required: true },
    taskKey: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    providerRequestId: { type: String, default: null },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    estimatedUsd: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    status: { type: String, enum: ['ok', 'error'], required: true },
    errorCode: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false, strict: 'throw' },
);
aiUsageSchema.index({ institutionId: 1, at: -1 });
aiUsageSchema.plugin(tenantScopedPlugin);
