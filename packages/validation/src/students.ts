import { z } from 'zod';
import { QUESTION_TYPES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { EmailSchema } from './auth.js';
import { requestContract, responseContract } from './registry.js';

/* ───────────── student self-service auth ───────────── */
export const StudentPasswordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), {
    message: 'Use letters and at least one number',
  });

export const RegisterStudentSchema = requestContract(
  'RegisterStudentRequest',
  z.object({
    email: EmailSchema,
    password: StudentPasswordSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    institutionSlug: z.string().trim().toLowerCase().max(60),
    programmeId: ObjectIdSchema.optional(),
    levelId: ObjectIdSchema.optional(),
  }),
);
export const TokenRequestSchema = requestContract(
  'TokenRequest',
  z.object({ token: z.string().min(10).max(200) }),
);
export const ForgotPasswordSchema = requestContract(
  'ForgotPasswordRequest',
  z.object({ email: EmailSchema }),
);
export const ResetPasswordSchema = requestContract(
  'ResetPasswordRequest',
  z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(128) }),
);
export const AcceptedSchema = responseContract(
  'Accepted',
  z.object({ accepted: z.literal(true), message: z.string() }),
);

/* ───────────── enrolments & progress ───────────── */
export const EnrolSchema = requestContract('EnrolRequest', z.object({ courseId: ObjectIdSchema }));
export const EnrolmentSchema = responseContract(
  'Enrolment',
  z.object({
    id: ObjectIdSchema,
    courseId: ObjectIdSchema,
    courseCode: z.string(),
    courseTitle: z.string(),
    enrolledAt: IsoDateSchema,
    progress: z.object({
      completedMaterials: z.number().int(),
      totalMaterials: z.number().int(),
      percent: z.number().int(),
    }),
  }),
);
export const ProgressUpdateSchema = requestContract(
  'ProgressUpdateRequest',
  z.object({
    state: z.enum(['in_progress', 'completed']),
    percent: z.number().int().min(0).max(100).optional(),
    timeSpentSec: z
      .number()
      .int()
      .min(0)
      .max(4 * 3600)
      .default(0),
  }),
);
export const ProgressSchema = responseContract(
  'Progress',
  z.object({
    materialId: ObjectIdSchema,
    courseId: ObjectIdSchema,
    state: z.enum(['not_started', 'in_progress', 'completed']),
    percent: z.number().int(),
    timeSpentSec: z.number().int(),
    updatedAt: IsoDateSchema,
  }),
);

/* ───────────── quiz attempts (graded server-side) ───────────── */
export const QuizAttemptSchema = requestContract(
  'QuizAttemptRequest',
  z.object({
    answers: z
      .array(
        z.object({
          questionId: ObjectIdSchema,
          optionId: z.string().max(40).optional(),
          text: z.string().max(2000).optional(),
        }),
      )
      .max(100),
    startedAt: IsoDateSchema.optional(),
  }),
);
export const QuizAttemptResultSchema = responseContract(
  'QuizAttemptResult',
  z.object({
    id: ObjectIdSchema,
    materialId: ObjectIdSchema,
    score: z.number().int(),
    maxScore: z.number().int(),
    percent: z.number().int(),
    passed: z.boolean(),
    pendingManualReview: z.number().int(),
    results: z.array(
      z.object({
        questionId: ObjectIdSchema,
        type: z.enum(QUESTION_TYPES),
        outcome: z.enum(['correct', 'incorrect', 'unanswered', 'needs_review']),
        correctOptionId: z.string().nullable(),
        acceptedAnswers: z.array(z.string()),
        explanation: z.string(),
      }),
    ),
    submittedAt: IsoDateSchema,
  }),
);

/* ───────────── admin views ───────────── */
export const StudentListQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export const StudentAccountSchema = responseContract(
  'StudentAccount',
  z.object({
    id: ObjectIdSchema,
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.enum(['invited', 'active', 'suspended', 'deactivated']),
    emailVerified: z.boolean(),
    programme: z.string().nullable(),
    level: z.string().nullable(),
    enrolments: z.number().int(),
    lastLoginAt: IsoDateSchema.nullable(),
    createdAt: IsoDateSchema,
  }),
);

export const DashboardOverviewSchema = responseContract(
  'DashboardOverview',
  z.object({
    counts: z.object({
      institutions: z.number().int(),
      departments: z.number().int(),
      programmes: z.number().int(),
      courses: z.number().int(),
      publishedCourses: z.number().int(),
      topics: z.number().int(),
      publishedLessons: z.number().int(),
      draftLessons: z.number().int(),
      awaitingReview: z.number().int(),
      questionsAwaitingReview: z.number().int(),
      failedJobs30d: z.number().int(),
      registeredStudents: z.number().int(),
      activeStudents30d: z.number().int(),
      aiCallsThisMonth: z.number().int(),
      aiTokensThisMonth: z.number().int(),
    }),
    recentActivity: z.array(
      z.object({
        action: z.string(),
        actorName: z.string(),
        target: z.string(),
        at: IsoDateSchema,
      }),
    ),
  }),
);

export const EngagementQuerySchema = z.object({
  institutionId: ObjectIdSchema.optional(),
  courseId: ObjectIdSchema.optional(),
});
export const EngagementSchema = responseContract(
  'Engagement',
  z.object({
    enrolments: z.number().int(),
    activeLearners30d: z.number().int(),
    completions: z.number().int(),
    quizAttempts: z.number().int(),
    averageQuizPercent: z.number().nullable(),
    courses: z.array(
      z.object({
        courseId: ObjectIdSchema,
        code: z.string(),
        title: z.string(),
        enrolments: z.number().int(),
        completionPercent: z.number().int(),
        quizAttempts: z.number().int(),
        averageQuizPercent: z.number().nullable(),
      }),
    ),
    materials: z.array(
      z.object({
        materialId: ObjectIdSchema,
        label: z.string(),
        started: z.number().int(),
        completed: z.number().int(),
        averageQuizPercent: z.number().nullable(),
      }),
    ),
  }),
);

export const QuizAttemptSummarySchema = responseContract(
  'QuizAttemptSummary',
  z.object({
    id: ObjectIdSchema,
    score: z.number().int(),
    maxScore: z.number().int(),
    percent: z.number().int(),
    passed: z.boolean(),
    submittedAt: IsoDateSchema,
  }),
);
export const ProgressQuerySchema = z.object({ courseId: ObjectIdSchema.optional() });
export const StudentStatusSchema = requestContract(
  'StudentStatusRequest',
  z.object({
    status: z.enum(['active', 'suspended']),
    reason: z.string().trim().max(500).optional(),
  }),
);

export type Enrolment = z.infer<typeof EnrolmentSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type QuizAttemptResult = z.infer<typeof QuizAttemptResultSchema>;
export type QuizAttemptSummary = z.infer<typeof QuizAttemptSummarySchema>;
export type StudentAccount = z.infer<typeof StudentAccountSchema>;
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
export type Engagement = z.infer<typeof EngagementSchema>;
