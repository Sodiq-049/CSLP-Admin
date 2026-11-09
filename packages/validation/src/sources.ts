import { z } from 'zod';
import {
  JOB_STATUSES,
  JOB_TYPES,
  LICENCE_TYPES,
  PROCESSING_STATUSES,
  SOURCE_CATEGORIES,
} from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/** Multipart text fields accompanying the uploaded file (docs/04 §3.4). */
export const UploadSourceFieldsSchema = requestContract(
  'UploadSourceFields',
  z.object({
    title: z.string().trim().min(2).max(300),
    category: z.enum(SOURCE_CATEGORIES),
    courseId: ObjectIdSchema.optional(),
    authors: z.string().trim().max(500).optional(),
    publisher: z.string().trim().max(200).optional(),
    year: z.coerce.number().int().min(1800).max(2100).optional(),
    licenceType: z.enum(LICENCE_TYPES),
    licenceNotes: z.string().trim().max(1000).optional(),
    /** The uploader confirms the institution may use this material (brief §9: respect copyright). */
    licenceConfirmed: z.enum(['true']),
  }),
);

export const SourceListQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  courseId: ObjectIdSchema.optional(),
  category: z.enum(SOURCE_CATEGORIES).optional(),
  status: z.enum(PROCESSING_STATUSES).optional(),
});

export const SourceDocumentSchema = responseContract(
  'SourceDocument',
  z.object({
    id: ObjectIdSchema,
    institutionId: ObjectIdSchema,
    courseId: ObjectIdSchema.nullable(),
    title: z.string(),
    authors: z.array(z.string()),
    publisher: z.string().nullable(),
    year: z.number().int().nullable(),
    category: z.enum(SOURCE_CATEGORIES),
    licence: z.object({
      type: z.enum(LICENCE_TYPES),
      notes: z.string().nullable(),
      confirmedAt: IsoDateSchema,
    }),
    file: z.object({
      name: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int(),
      pageCount: z.number().int().nullable(),
    }),
    processing: z.object({
      status: z.enum(PROCESSING_STATUSES),
      chunkCount: z.number().int(),
      embedded: z.boolean(),
      error: z.string().nullable(),
      warnings: z.array(z.string()),
    }),
    scanStatus: z.enum(['pending', 'clean', 'infected', 'skipped']),
    approvedForGeneration: z.boolean(),
    approvedAt: IsoDateSchema.nullable(),
    createdAt: IsoDateSchema,
  }),
);
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export const DocumentChunkSchema = responseContract(
  'DocumentChunk',
  z.object({
    id: ObjectIdSchema,
    ordinal: z.number().int(),
    text: z.string(),
    tokenCount: z.number().int(),
    page: z.number().int().nullable(),
    headingPath: z.array(z.string()),
    embedded: z.boolean(),
  }),
);

export const DownloadUrlSchema = responseContract(
  'DownloadUrl',
  z.object({ url: z.string(), expiresAt: IsoDateSchema }),
);

export const GenerationJobSchema = responseContract(
  'GenerationJob',
  z.object({
    id: ObjectIdSchema,
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES),
    progress: z.object({ pct: z.number(), stage: z.string(), message: z.string().nullable() }),
    attempts: z.number().int(),
    error: z.string().nullable(),
    target: z.object({
      sourceDocumentId: ObjectIdSchema.nullable(),
      outlineId: ObjectIdSchema.nullable(),
      courseId: ObjectIdSchema.nullable(),
    }),
    createdAt: IsoDateSchema,
    finishedAt: IsoDateSchema.nullable(),
  }),
);
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export const ChunkQuerySchema = PageQuerySchema.pick({ page: true, pageSize: true });
