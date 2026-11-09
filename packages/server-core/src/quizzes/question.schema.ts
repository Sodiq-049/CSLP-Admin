import { Schema, Types } from 'mongoose';
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  type Difficulty,
  type QuestionType,
} from '@cslp/shared-types';
import { baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

/** Question bank (docs/02 §6). Approved revisions are immutable; editing creates revision + 1. */
export interface QuestionDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId;
  topicId: Types.ObjectId;
  lineageId: Types.ObjectId;
  revision: number;
  isLatest: boolean;
  type: QuestionType;
  stem: string;
  options: { id: string; text: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
  explanation: string;
  difficulty: Difficulty;
  sourceLessonVersionId: Types.ObjectId | null;
  origin: 'ai_generated' | 'manual';
  generation: { provider: string; model: string; jobId: Types.ObjectId | null } | null;
  reviewStatus: 'draft' | 'approved' | 'rejected';
  reviewedBy: Types.ObjectId | null;
  reviewComment: string | null;
  stemHash: string;
  duplicateOf: Types.ObjectId | null;
  isOfficialAssessment: boolean;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export const questionSchema = new Schema<QuestionDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    topicId: { type: Schema.Types.ObjectId, required: true },
    lineageId: { type: Schema.Types.ObjectId, required: true },
    revision: { type: Number, required: true },
    isLatest: { type: Boolean, default: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    stem: { type: String, required: true },
    options: { type: [{ _id: false, id: String, text: String, isCorrect: Boolean }], default: [] },
    acceptedAnswers: { type: [String], default: [] },
    explanation: { type: String, default: '' },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
    sourceLessonVersionId: { type: Schema.Types.ObjectId, default: null },
    origin: { type: String, enum: ['ai_generated', 'manual'], required: true },
    generation: { type: Schema.Types.Mixed, default: null },
    reviewStatus: { type: String, enum: ['draft', 'approved', 'rejected'], default: 'draft' },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewComment: { type: String, default: null },
    stemHash: { type: String, required: true },
    duplicateOf: { type: Schema.Types.ObjectId, default: null },
    isOfficialAssessment: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
questionSchema.index({ institutionId: 1, lineageId: 1, revision: -1 }, { unique: true });
questionSchema.index({ institutionId: 1, courseId: 1, topicId: 1, isLatest: 1, reviewStatus: 1 });
questionSchema.index({ institutionId: 1, courseId: 1, stemHash: 1 });
questionSchema.plugin(tenantScopedPlugin);
