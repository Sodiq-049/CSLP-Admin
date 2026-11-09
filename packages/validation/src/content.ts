import { z } from 'zod';
import {
  DISPLAY_STATUSES,
  GENERATABLE_KINDS,
  GENERATION_STATUSES,
  MATERIAL_KINDS,
  PUBLICATION_STATES,
  REVIEW_STATUSES,
} from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/* ───────────── AI output schemas (docs/06 §5) ─────────────
 * Strict-structured-output friendly: no optional fields; unused fields are empty. */

export const NOTE_SECTION_TYPES = [
  'introduction',
  'definitions',
  'history',
  'concept',
  'step_by_step',
  'application',
  'examples',
  'code_example',
  'common_mistakes',
  'terminology',
  'conclusion',
] as const;

export const NotesBlockOutput = z.object({
  kind: z.enum(['paragraph', 'bullets', 'numbered', 'code', 'table', 'callout']),
  text: z.string(),
  items: z.array(z.string()),
  language: z.string(),
  rows: z.array(z.array(z.string())),
  citations: z.array(z.string()),
});
export const NotesOutputSchema = z.object({
  title: z.string(),
  learningObjectives: z.array(z.string()),
  sections: z.array(
    z.object({
      type: z.enum(NOTE_SECTION_TYPES),
      heading: z.string(),
      provenance: z.enum(['source_grounded', 'ai_supplementary']),
      blocks: z.array(NotesBlockOutput),
    }),
  ),
  glossary: z.array(
    z.object({ term: z.string(), definition: z.string(), citations: z.array(z.string()) }),
  ),
  insufficientSources: z.boolean(),
  missingTopics: z.array(z.string()),
});
export type NotesOutput = z.infer<typeof NotesOutputSchema>;

export const RevisionPackOutputSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  checklist: z.array(z.string()),
  insufficientSources: z.boolean(),
  missingTopics: z.array(z.string()),
});
export type RevisionPackOutput = z.infer<typeof RevisionPackOutputSchema>;

/* ───────────── generation requests ───────────── */

export const GenerationOptionsSchema = z.object({
  depth: z.enum(['overview', 'standard', 'in_depth']).default('standard'),
  style: z.enum(['formal', 'conversational']).default('formal'),
  examplesCount: z.number().int().min(0).max(10).default(3),
  includeCode: z.boolean().default(false),
  codeLanguage: z.string().trim().max(30).default('python'),
  nigerianContext: z.boolean().default(true),
});
export type GenerationOptions = z.output<typeof GenerationOptionsSchema>;

export const GenerateContentSchema = requestContract(
  'GenerateContentRequest',
  z.object({
    topicIds: z.array(ObjectIdSchema).min(1).max(50),
    kinds: z.array(z.enum(GENERATABLE_KINDS)).min(1).max(3),
    options: GenerationOptionsSchema.default(GenerationOptionsSchema.parse({})),
  }),
);

export const GenerationBatchSchema = responseContract(
  'GenerationBatch',
  z.object({
    jobs: z.array(
      z.object({
        jobId: ObjectIdSchema,
        topicId: ObjectIdSchema,
        kind: z.enum(GENERATABLE_KINDS),
        materialId: ObjectIdSchema,
        versionId: ObjectIdSchema,
        deduplicated: z.boolean(),
      }),
    ),
  }),
);

/* ───────────── materials & versions ───────────── */

/** TipTap/ProseMirror JSON. Sanitised server-side against an allow-list of nodes and marks. */
export const RichDocSchema = z.object({ type: z.literal('doc'), content: z.array(z.any()) });
export type RichDoc = z.infer<typeof RichDocSchema>;

export const NotesBodySchema = z.object({
  kind: z.literal('notes'),
  doc: RichDocSchema,
  wordCount: z.number().int(),
  readingMinutes: z.number().int(),
});
export const RevisionBodySchema = z.object({
  kind: z.literal('revision_pack'),
  summary: z.string(),
  keyPoints: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })),
  checklist: z.array(z.string()),
});
export const QuizBodySchema = z.object({
  kind: z.literal('quiz'),
  questionRefs: z.array(
    z.object({ questionId: ObjectIdSchema, lineageId: ObjectIdSchema, revision: z.number().int() }),
  ),
  settings: z.object({
    shuffle: z.boolean(),
    timeLimitMinutes: z.number().int().nullable(),
    passMarkPercent: z.number().int(),
  }),
});
export const VersionBodySchema = z.discriminatedUnion('kind', [
  NotesBodySchema,
  RevisionBodySchema,
  QuizBodySchema,
]);
export type VersionBody = z.infer<typeof VersionBodySchema>;

export const CitationSchema = z.object({
  label: z.string(),
  index: z.number().int(),
  sourceDocumentId: ObjectIdSchema,
  sourceTitle: z.string(),
  chunkId: ObjectIdSchema,
  page: z.number().int().nullable(),
  quote: z.string(),
});

export const VersionSummarySchema = z.object({
  id: ObjectIdSchema,
  versionNumber: z.number().int(),
  generationStatus: z.enum(GENERATION_STATUSES),
  reviewStatus: z.enum(REVIEW_STATUSES),
  origin: z.enum(['ai_generated', 'manual', 'ai_assisted_edit']),
  createdAt: IsoDateSchema,
});

export const LearningMaterialSchema = responseContract(
  'LearningMaterial',
  z.object({
    id: ObjectIdSchema,
    courseId: ObjectIdSchema,
    topicId: ObjectIdSchema,
    kind: z.enum(MATERIAL_KINDS),
    title: z.string(),
    displayStatus: z.enum(DISPLAY_STATUSES),
    publication: z.object({ state: z.enum(PUBLICATION_STATES) }),
    currentDraftVersionId: ObjectIdSchema.nullable(),
    latestApprovedVersionId: ObjectIdSchema.nullable(),
    publishedVersionId: ObjectIdSchema.nullable(),
    versions: z.array(VersionSummarySchema),
    updatedAt: IsoDateSchema,
  }),
);
export type LearningMaterial = z.infer<typeof LearningMaterialSchema>;

export const ReviewSchema = z.object({
  id: ObjectIdSchema,
  reviewerId: ObjectIdSchema,
  reviewerName: z.string(),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  comment: z.string(),
  checklist: z.object({
    accuracy: z.boolean(),
    objectivesCovered: z.boolean(),
    citationsChecked: z.boolean(),
    appropriateLevel: z.boolean(),
  }),
  createdAt: IsoDateSchema,
});

export const ContentVersionSchema = responseContract(
  'ContentVersion',
  z.object({
    id: ObjectIdSchema,
    materialId: ObjectIdSchema,
    courseId: ObjectIdSchema,
    topicId: ObjectIdSchema,
    kind: z.enum(MATERIAL_KINDS),
    versionNumber: z.number().int(),
    parentVersionId: ObjectIdSchema.nullable(),
    origin: z.enum(['ai_generated', 'manual', 'ai_assisted_edit']),
    generationStatus: z.enum(GENERATION_STATUSES),
    reviewStatus: z.enum(REVIEW_STATUSES),
    frozen: z.boolean(),
    body: VersionBodySchema.nullable(),
    provenance: z.object({
      citations: z.array(CitationSchema),
      insufficientSources: z.boolean(),
      missingTopics: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
    generation: z
      .object({
        provider: z.string(),
        model: z.string(),
        taskKey: z.string(),
        promptVersion: z.string(),
        jobId: ObjectIdSchema.nullable(),
        error: z.string().nullable(),
      })
      .nullable(),
    autosaveRev: z.number().int(),
    createdBy: ObjectIdSchema.nullable(),
    submittedBy: ObjectIdSchema.nullable(),
    submittedAt: IsoDateSchema.nullable(),
    approvedBy: ObjectIdSchema.nullable(),
    approvedAt: IsoDateSchema.nullable(),
    reviews: z.array(ReviewSchema),
    context: z.object({
      courseCode: z.string(),
      courseTitle: z.string(),
      topicTitle: z.string(),
      institutionId: ObjectIdSchema,
    }),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  }),
);
export type ContentVersion = z.infer<typeof ContentVersionSchema>;

export const UpdateVersionSchema = requestContract(
  'UpdateVersionRequest',
  z.object({
    /** The autosaveRev the client last saw; a mismatch returns 412 (edited elsewhere). */
    autosaveRev: z.number().int().min(0),
    body: VersionBodySchema,
  }),
);

export const ReviewDecisionSchema = requestContract(
  'ReviewDecisionRequest',
  z
    .object({
      decision: z.enum(['approved', 'changes_requested', 'rejected']),
      comment: z.string().trim().max(5000).default(''),
      checklist: z.object({
        accuracy: z.boolean(),
        objectivesCovered: z.boolean(),
        citationsChecked: z.boolean(),
        appropriateLevel: z.boolean(),
      }),
    })
    .refine((v) => v.decision === 'approved' || v.comment.length >= 5, {
      path: ['comment'],
      message: 'Explain what needs to change',
    })
    .refine((v) => v.decision !== 'approved' || Object.values(v.checklist).every(Boolean), {
      path: ['checklist'],
      message: 'Confirm every checklist item before approving',
    }),
);

export const ReviewQueueItemSchema = responseContract(
  'ReviewQueueItem',
  z.object({
    versionId: ObjectIdSchema,
    materialId: ObjectIdSchema,
    kind: z.enum(MATERIAL_KINDS),
    versionNumber: z.number().int(),
    courseId: ObjectIdSchema,
    courseCode: z.string(),
    courseTitle: z.string(),
    topicTitle: z.string(),
    submittedAt: IsoDateSchema.nullable(),
    submittedByName: z.string(),
    insufficientSources: z.boolean(),
  }),
);
