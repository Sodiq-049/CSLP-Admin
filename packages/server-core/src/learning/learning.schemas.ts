import { Schema, Types } from 'mongoose';
import {
  MATERIAL_KINDS,
  QUESTION_TYPES,
  type MaterialKind,
  type QuestionType,
} from '@cslp/shared-types';
import { baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

/** Student learning records (docs/02 §9). Always scoped by the student's own institution. */
export interface EnrolmentDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  enrolledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
export const enrolmentSchema = new Schema<EnrolmentDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    enrolledAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);
enrolmentSchema.index({ institutionId: 1, userId: 1, courseId: 1 }, { unique: true });
enrolmentSchema.index({ institutionId: 1, courseId: 1 });
enrolmentSchema.plugin(tenantScopedPlugin);

export const PROGRESS_STATES = ['not_started', 'in_progress', 'completed'] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];
export interface MaterialProgressDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  topicId: Types.ObjectId;
  materialId: Types.ObjectId;
  kind: MaterialKind;
  state: ProgressState;
  percent: number;
  timeSpentSec: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export const materialProgressSchema = new Schema<MaterialProgressDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    topicId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: MATERIAL_KINDS, required: true },
    state: { type: String, enum: PROGRESS_STATES, default: 'not_started' },
    percent: { type: Number, default: 0 },
    timeSpentSec: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
materialProgressSchema.index({ institutionId: 1, userId: 1, materialId: 1 }, { unique: true });
materialProgressSchema.index({ institutionId: 1, courseId: 1, updatedAt: -1 });
materialProgressSchema.plugin(tenantScopedPlugin);

export const ANSWER_OUTCOMES = ['correct', 'incorrect', 'unanswered', 'needs_review'] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];
export interface QuizAttemptDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  topicId: Types.ObjectId;
  materialId: Types.ObjectId;
  versionId: Types.ObjectId;
  answers: {
    questionId: Types.ObjectId;
    type: QuestionType;
    optionId: string | null;
    text: string | null;
    outcome: AnswerOutcome;
  }[];
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  pendingManualReview: number;
  startedAt: Date | null;
  submittedAt: Date;
  createdAt: Date;
}
const attemptAnswerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    optionId: { type: String, default: null },
    text: { type: String, default: null },
    outcome: { type: String, enum: ANSWER_OUTCOMES, required: true },
  },
  { _id: false, strict: 'throw' },
);
export const quizAttemptSchema: Schema<QuizAttemptDoc> = new Schema<QuizAttemptDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    topicId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    versionId: { type: Schema.Types.ObjectId, required: true },
    answers: { type: [attemptAnswerSchema], default: [] },
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    percent: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    pendingManualReview: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, required: true },
  },
  baseSchemaOptions,
);
quizAttemptSchema.index({ institutionId: 1, userId: 1, materialId: 1, submittedAt: -1 });
quizAttemptSchema.index({ institutionId: 1, courseId: 1, submittedAt: -1 });
quizAttemptSchema.plugin(tenantScopedPlugin);
