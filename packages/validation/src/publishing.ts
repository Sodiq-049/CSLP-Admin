import { z } from 'zod';
import { MATERIAL_KINDS, PUBLICATION_STATES, QUESTION_TYPES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/* ───────────── admin: publishing actions (docs/05 §5) ───────────── */
export const PublishMaterialSchema = requestContract(
  'PublishMaterialRequest',
  z.object({ versionId: ObjectIdSchema }),
);
export const ScheduleMaterialSchema = requestContract(
  'ScheduleMaterialRequest',
  z.object({ versionId: ObjectIdSchema, publishAt: IsoDateSchema }),
);
export const UnpublishSchema = requestContract(
  'UnpublishRequest',
  z.object({ reason: z.string().trim().min(3).max(500) }),
);
export const RollbackSchema = requestContract(
  'RollbackRequest',
  z.object({ toVersionId: ObjectIdSchema, reason: z.string().trim().min(3).max(500) }),
);
export const PublishBundleSchema = requestContract(
  'PublishBundleRequest',
  z.object({
    courseId: ObjectIdSchema,
    items: z.array(z.object({ materialId: ObjectIdSchema, versionId: ObjectIdSchema })).max(200),
    publishCourse: z.boolean().default(false),
    topicIds: z.array(ObjectIdSchema).max(200).default([]),
  }),
);

export const PublishingItemSchema = z.object({
  materialId: ObjectIdSchema,
  kind: z.enum(MATERIAL_KINDS),
  courseId: ObjectIdSchema,
  courseCode: z.string(),
  courseTitle: z.string(),
  coursePublished: z.boolean(),
  topicId: ObjectIdSchema,
  topicTitle: z.string(),
  topicPublished: z.boolean(),
  state: z.enum(PUBLICATION_STATES),
  publishedVersionId: ObjectIdSchema.nullable(),
  publishedVersionNumber: z.number().int().nullable(),
  latestApprovedVersionId: ObjectIdSchema.nullable(),
  latestApprovedVersionNumber: z.number().int().nullable(),
  scheduledFor: IsoDateSchema.nullable(),
  publishedAt: IsoDateSchema.nullable(),
});
export type PublishingItem = z.infer<typeof PublishingItemSchema>;

export const PublishingOverviewSchema = responseContract(
  'PublishingOverview',
  z.object({
    ready: z.array(PublishingItemSchema),
    scheduled: z.array(PublishingItemSchema),
    published: z.array(PublishingItemSchema),
  }),
);

export const PublicationEventSchema = responseContract(
  'PublicationEvent',
  z.object({
    id: ObjectIdSchema,
    action: z.enum([
      'publish',
      'schedule',
      'cancel_schedule',
      'unpublish',
      'rollback',
      'publish_course',
      'unpublish_course',
      'publish_topic',
      'unpublish_topic',
    ]),
    target: z.object({ type: z.enum(['material', 'course', 'topic']), id: ObjectIdSchema }),
    label: z.string(),
    fromVersionNumber: z.number().int().nullable(),
    toVersionNumber: z.number().int().nullable(),
    reason: z.string().nullable(),
    actorName: z.string(),
    at: IsoDateSchema,
  }),
);
export const PublicationEventQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  courseId: ObjectIdSchema.optional(),
});

export const PublicationStateSchema = responseContract(
  'PublicationResult',
  z.object({
    id: ObjectIdSchema,
    state: z.enum(PUBLICATION_STATES),
    publishedVersionId: ObjectIdSchema.nullable(),
    scheduledFor: IsoDateSchema.nullable(),
  }),
);

/* ───────────── student-facing (published content only) ───────────── */
export const StudentCourseSummarySchema = responseContract(
  'StudentCourseSummary',
  z.object({
    id: ObjectIdSchema,
    code: z.string(),
    title: z.string(),
    creditUnits: z.number().int(),
    description: z.string(),
    programme: z.string(),
    level: z.string(),
    semester: z.string(),
    topicCount: z.number().int(),
  }),
);

const StudentMaterialSummary = z.object({
  id: ObjectIdSchema,
  kind: z.enum(MATERIAL_KINDS),
  title: z.string(),
  publishedAt: IsoDateSchema.nullable(),
});
export const StudentCourseDetailSchema = responseContract(
  'StudentCourseDetail',
  StudentCourseSummarySchema.extend({
    objectives: z.array(z.string()),
    topics: z.array(
      z.object({
        id: ObjectIdSchema,
        title: z.string(),
        slug: z.string(),
        materials: z.array(StudentMaterialSummary),
        subtopics: z.array(
          z.object({
            id: ObjectIdSchema,
            title: z.string(),
            slug: z.string(),
            materials: z.array(StudentMaterialSummary),
          }),
        ),
      }),
    ),
  }),
);

export const StudentQuestionSchema = z.object({
  id: ObjectIdSchema,
  type: z.enum(QUESTION_TYPES),
  stem: z.string(),
  /** Answer flags are never sent to students; grading happens server-side. */
  options: z.array(z.object({ id: z.string(), text: z.string() })),
});

export const StudentMaterialSchema = responseContract(
  'StudentMaterial',
  z.object({
    id: ObjectIdSchema,
    kind: z.enum(MATERIAL_KINDS),
    title: z.string(),
    course: z.object({ id: ObjectIdSchema, code: z.string(), title: z.string() }),
    topic: z.object({ id: ObjectIdSchema, title: z.string() }),
    publishedAt: IsoDateSchema.nullable(),
    content: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('notes'),
        doc: z.object({ type: z.literal('doc'), content: z.array(z.any()) }),
        wordCount: z.number().int(),
        readingMinutes: z.number().int(),
      }),
      z.object({
        kind: z.literal('revision_pack'),
        summary: z.string(),
        keyPoints: z.array(z.string()),
        flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
        faq: z.array(z.object({ question: z.string(), answer: z.string() })),
        checklist: z.array(z.string()),
      }),
      z.object({
        kind: z.literal('quiz'),
        settings: z.object({
          shuffle: z.boolean(),
          timeLimitMinutes: z.number().int().nullable(),
          passMarkPercent: z.number().int(),
        }),
        questions: z.array(StudentQuestionSchema),
      }),
    ]),
    citations: z.array(
      z.object({
        index: z.number().int(),
        sourceTitle: z.string(),
        page: z.number().int().nullable(),
      }),
    ),
    aiAssisted: z.boolean(),
  }),
);
export type StudentMaterial = z.infer<typeof StudentMaterialSchema>;

export const StudentCourseQuerySchema = PageQuerySchema.extend({
  programmeId: ObjectIdSchema.optional(),
  levelId: ObjectIdSchema.optional(),
  semesterId: ObjectIdSchema.optional(),
});
