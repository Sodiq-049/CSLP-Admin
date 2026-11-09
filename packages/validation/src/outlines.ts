import { z } from 'zod';
import { EXTRACTION_STATUSES, OUTLINE_ORIGINS, OUTLINE_STATUSES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/** Two levels, matching Topic → Subtopic. */
const SubNode = z.object({
  key: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  sourceQuote: z.string().max(500).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).nullable().default(null),
});
export const OutlineNodeSchema = SubNode.extend({ children: z.array(SubNode).max(50).default([]) });
export type OutlineNode = z.infer<typeof OutlineNodeSchema>;
export const OutlineStructureSchema = z.array(OutlineNodeSchema).max(100);

export const CreateOutlineSchema = requestContract(
  'CreateOutlineRequest',
  z.discriminatedUnion('origin', [
    z.object({ origin: z.literal('paste'), text: z.string().trim().min(20).max(200_000) }),
    z.object({ origin: z.literal('manual'), structure: OutlineStructureSchema.min(1) }),
  ]),
);

export const UpdateOutlineSchema = requestContract(
  'UpdateOutlineRequest',
  z.object({ structure: OutlineStructureSchema }),
);

export const DetectedMetadataSchema = z.object({
  courseCode: z.string().nullable(),
  courseTitle: z.string().nullable(),
  creditUnits: z.number().nullable(),
  objectives: z.array(z.string()),
});

export const CourseOutlineSchema = responseContract(
  'CourseOutline',
  z.object({
    id: ObjectIdSchema,
    courseId: ObjectIdSchema,
    version: z.number().int(),
    origin: z.enum(OUTLINE_ORIGINS),
    sourceDocumentId: ObjectIdSchema.nullable(),
    status: z.enum(OUTLINE_STATUSES),
    rawText: z.string().nullable(),
    structure: OutlineStructureSchema,
    extraction: z.object({
      status: z.enum(EXTRACTION_STATUSES),
      method: z.enum(['heuristic', 'ai']).nullable(),
      suggestedStructure: OutlineStructureSchema,
      detectedMetadata: DetectedMetadataSchema.nullable(),
      warnings: z.array(z.string()),
      error: z.string().nullable(),
    }),
    approvedBy: ObjectIdSchema.nullable(),
    approvedAt: IsoDateSchema.nullable(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  }),
);
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;

export const TopicSyncPlanSchema = responseContract(
  'TopicSyncPlan',
  z.object({
    applied: z.boolean(),
    create: z.array(
      z.object({ key: z.string(), title: z.string(), parentTitle: z.string().nullable() }),
    ),
    matched: z.array(z.object({ key: z.string(), title: z.string(), topicId: ObjectIdSchema })),
    notInOutline: z.array(z.object({ topicId: ObjectIdSchema, title: z.string() })),
  }),
);
export type TopicSyncPlan = z.infer<typeof TopicSyncPlanSchema>;

export const OutlineReviewItemSchema = responseContract(
  'OutlineReviewItem',
  z.object({
    outline: CourseOutlineSchema,
    course: z.object({ id: ObjectIdSchema, code: z.string(), title: z.string() }),
  }),
);

/** Multipart fields for an outline file upload: the uploader confirms the licence (brief §9). */
export const UploadOutlineFieldsSchema = requestContract(
  'UploadOutlineFields',
  z.object({ licenceConfirmed: z.enum(['true']) }),
);

export const SyncTopicsQuerySchema = z.object({
  apply: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
