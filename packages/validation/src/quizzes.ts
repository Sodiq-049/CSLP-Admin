import { z } from 'zod';
import { DIFFICULTIES, EDITOR_ACTIONS, QUESTION_TYPES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/* ───────────── AI output (strict-mode friendly) ───────────── */
export const QuestionSetOutputSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(QUESTION_TYPES),
      stem: z.string(),
      options: z.array(z.string()),
      correctOptionIndex: z.number().int(),
      acceptedAnswers: z.array(z.string()),
      explanation: z.string(),
      difficulty: z.enum(DIFFICULTIES),
      sectionHeading: z.string(),
    }),
  ),
});
export type QuestionSetOutput = z.infer<typeof QuestionSetOutputSchema>;

/* ───────────── questions ───────────── */
export const QuestionOptionSchema = z.object({
  id: z.string(),
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean(),
});

export const QuestionSchema = responseContract(
  'Question',
  z.object({
    id: ObjectIdSchema,
    lineageId: ObjectIdSchema,
    revision: z.number().int(),
    courseId: ObjectIdSchema,
    topicId: ObjectIdSchema,
    type: z.enum(QUESTION_TYPES),
    stem: z.string(),
    options: z.array(QuestionOptionSchema),
    acceptedAnswers: z.array(z.string()),
    explanation: z.string(),
    difficulty: z.enum(DIFFICULTIES),
    sourceLessonVersionId: ObjectIdSchema.nullable(),
    origin: z.enum(['ai_generated', 'manual']),
    provider: z.string().nullable(),
    reviewStatus: z.enum(['draft', 'approved', 'rejected']),
    reviewComment: z.string().nullable(),
    duplicateOf: ObjectIdSchema.nullable(),
    isLatest: z.boolean(),
    createdBy: ObjectIdSchema.nullable(),
    topicTitle: z.string(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
  }),
);
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionListQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  courseId: ObjectIdSchema.optional(),
  topicId: ObjectIdSchema.optional(),
  status: z.enum(['draft', 'approved', 'rejected']).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
});

/** Same validity rules as generated questions (enforced server-side). */
export const UpdateQuestionSchema = requestContract(
  'UpdateQuestionRequest',
  z.object({
    stem: z.string().trim().min(5).max(2000),
    options: z.array(QuestionOptionSchema).max(6),
    acceptedAnswers: z.array(z.string().trim().min(1).max(300)).max(10),
    explanation: z.string().trim().max(2000),
    difficulty: z.enum(DIFFICULTIES),
  }),
);

export const QuestionReviewSchema = requestContract(
  'QuestionReviewRequest',
  z
    .object({
      decision: z.enum(['approved', 'rejected']),
      comment: z.string().trim().max(1000).default(''),
    })
    .refine((v) => v.decision === 'approved' || v.comment.length >= 3, {
      path: ['comment'],
      message: 'Say why the question is rejected',
    }),
);

export const GenerateQuestionsSchema = requestContract(
  'GenerateQuestionsRequest',
  z.object({
    count: z.number().int().min(1).max(30).default(10),
    types: z.array(z.enum(QUESTION_TYPES)).min(1).default(['mcq_single', 'true_false']),
    difficulty: z.enum(['mixed', ...DIFFICULTIES]).default('mixed'),
  }),
);

export const QuestionJobSchema = responseContract(
  'QuestionJob',
  z.object({ jobId: ObjectIdSchema, deduplicated: z.boolean() }),
);

/* ───────────── quizzes ───────────── */
export const QuizSettingsSchema = z.object({
  shuffle: z.boolean().default(true),
  timeLimitMinutes: z.number().int().min(1).max(240).nullable().default(null),
  passMarkPercent: z.number().int().min(0).max(100).default(50),
});

export const ComposeQuizSchema = requestContract(
  'ComposeQuizRequest',
  z.object({
    questionIds: z.array(ObjectIdSchema).min(1).max(100),
    settings: QuizSettingsSchema.default(QuizSettingsSchema.parse({})),
  }),
);

/* ───────────── editor AI actions ───────────── */
export const EditorActionSchema = requestContract(
  'EditorActionRequest',
  z.object({
    action: z.enum(EDITOR_ACTIONS),
    text: z.string().trim().min(3).max(4000),
    context: z.string().max(4000).default(''),
  }),
);
export const EditorActionResultSchema = responseContract(
  'EditorActionResult',
  z.object({ suggestion: z.string(), provider: z.string() }),
);
export const EditorActionOutputSchema = z.object({ suggestion: z.string() });

/* ───────────── AI usage ───────────── */
const UsageRow = z.object({
  key: z.string(),
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  estimatedUsd: z.number().nullable(),
  errors: z.number().int(),
});
export const AiUsageSummarySchema = responseContract(
  'AiUsageSummary',
  z.object({
    month: z.string(),
    institutionId: ObjectIdSchema.nullable(),
    totals: UsageRow.omit({ key: true }),
    budgetUsd: z.number().nullable(),
    pricesConfigured: z.boolean(),
    byTask: z.array(UsageRow),
    byModel: z.array(UsageRow),
    daily: z.array(
      z.object({ date: z.string(), calls: z.number().int(), tokens: z.number().int() }),
    ),
  }),
);
export type AiUsageSummary = z.infer<typeof AiUsageSummarySchema>;
export const AiUsageQuerySchema = z.object({
  institutionId: ObjectIdSchema.optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
