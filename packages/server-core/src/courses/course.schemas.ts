import { Schema, Types } from 'mongoose';
import {
  EXTRACTION_STATUSES,
  OUTLINE_ORIGINS,
  OUTLINE_STATUSES,
  PUBLICATION_STATES,
  type ExtractionStatus,
  type OutlineOrigin,
  type OutlineStatus,
  type PublicationState,
} from '@cslp/shared-types';
import { archivableFields, baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

export interface Objective {
  id: string;
  text: string;
  source: 'official' | 'admin';
}
const objectiveSchema = new Schema<Objective>(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    source: { type: String, enum: ['official', 'admin'], default: 'admin' },
  },
  { _id: false },
);

/* ───────── courses ───────── */
export interface CourseDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  facultyId: Types.ObjectId;
  departmentId: Types.ObjectId;
  programmeId: Types.ObjectId;
  levelId: Types.ObjectId;
  semesterId: Types.ObjectId;
  curriculumVersionId: Types.ObjectId | null;
  code: string;
  codeNormalized: string;
  title: string;
  creditUnits: number;
  description: string;
  objectives: Objective[];
  prerequisites: { courseId: Types.ObjectId | null; text: string }[];
  references: { citation: string; url: string | null; isbn: string | null }[];
  activeOutlineId: Types.ObjectId | null;
  isDemoData: boolean;
  publication: {
    state: PublicationState;
    publishedAt: Date | null;
    publishedBy: Types.ObjectId | null;
  };
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export const courseSchema = new Schema<CourseDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    facultyId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    programmeId: { type: Schema.Types.ObjectId, required: true },
    levelId: { type: Schema.Types.ObjectId, required: true },
    semesterId: { type: Schema.Types.ObjectId, required: true },
    curriculumVersionId: { type: Schema.Types.ObjectId, default: null },
    code: { type: String, required: true, trim: true },
    codeNormalized: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    creditUnits: { type: Number, required: true, min: 0, max: 30 },
    description: { type: String, default: '' },
    objectives: { type: [objectiveSchema], default: [] },
    prerequisites: {
      type: [
        { _id: false, courseId: { type: Schema.Types.ObjectId, default: null }, text: String },
      ],
      default: [],
    },
    references: {
      type: [
        {
          _id: false,
          citation: String,
          url: { type: String, default: null },
          isbn: { type: String, default: null },
        },
      ],
      default: [],
    },
    activeOutlineId: { type: Schema.Types.ObjectId, default: null },
    isDemoData: { type: Boolean, default: false },
    publication: {
      state: { type: String, enum: PUBLICATION_STATES, default: 'unpublished' },
      publishedAt: { type: Date, default: null },
      publishedBy: { type: Schema.Types.ObjectId, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    ...archivableFields,
  },
  baseSchemaOptions,
);
// Same code may exist in other institutions/programmes/curricula, never twice in one (docs/02 §4).
courseSchema.index(
  { institutionId: 1, programmeId: 1, curriculumVersionId: 1, codeNormalized: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } },
);
courseSchema.index({ institutionId: 1, levelId: 1, semesterId: 1 });
courseSchema.index({ institutionId: 1, departmentId: 1, updatedAt: -1 });
courseSchema.plugin(tenantScopedPlugin);

/* ───────── topics (topics + subtopics) ───────── */
export interface TopicDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  departmentId: Types.ObjectId;
  programmeId: Types.ObjectId;
  courseId: Types.ObjectId;
  parentTopicId: Types.ObjectId | null;
  title: string;
  slug: string;
  orderKey: string;
  depth: number;
  learningObjectives: Objective[];
  outlineNodeKey: string | null;
  publication: { state: PublicationState; publishedAt: Date | null };
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
export const topicSchema = new Schema<TopicDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    programmeId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    parentTopicId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    orderKey: { type: String, required: true },
    depth: { type: Number, required: true, min: 0, max: 1 },
    learningObjectives: { type: [objectiveSchema], default: [] },
    outlineNodeKey: { type: String, default: null },
    publication: {
      state: { type: String, enum: PUBLICATION_STATES, default: 'unpublished' },
      publishedAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    ...archivableFields,
  },
  baseSchemaOptions,
);
topicSchema.index({ institutionId: 1, courseId: 1, parentTopicId: 1, orderKey: 1 });
topicSchema.index({ courseId: 1, slug: 1 }, { unique: true });
topicSchema.plugin(tenantScopedPlugin);

/* ───────── course outlines (versioned) ───────── */
export interface OutlineNodeDoc {
  key: string;
  title: string;
  sourceQuote: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  children: Omit<OutlineNodeDoc, 'children'>[];
}
export interface CourseOutlineDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  courseId: Types.ObjectId;
  version: number;
  origin: OutlineOrigin;
  sourceDocumentId: Types.ObjectId | null;
  rawText: string | null;
  structure: OutlineNodeDoc[];
  extraction: {
    status: ExtractionStatus;
    method: 'heuristic' | 'ai' | null;
    jobId: Types.ObjectId | null;
    suggestedStructure: OutlineNodeDoc[];
    detectedMetadata: {
      courseCode: string | null;
      courseTitle: string | null;
      creditUnits: number | null;
      objectives: string[];
    } | null;
    warnings: string[];
    error: string | null;
  };
  status: OutlineStatus;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
const leaf = {
  key: String,
  title: String,
  sourceQuote: { type: String, default: null },
  confidence: { type: String, default: null },
};
const outlineNodeSchema = new Schema(
  { ...leaf, children: { type: [new Schema(leaf, { _id: false })], default: [] } },
  { _id: false },
);
export const courseOutlineSchema = new Schema<CourseOutlineDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, required: true },
    courseId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    origin: { type: String, enum: OUTLINE_ORIGINS, required: true },
    sourceDocumentId: { type: Schema.Types.ObjectId, default: null },
    rawText: { type: String, default: null },
    structure: { type: [outlineNodeSchema], default: [] },
    extraction: {
      status: { type: String, enum: EXTRACTION_STATUSES, default: 'none' },
      method: { type: String, enum: ['heuristic', 'ai', null], default: null },
      jobId: { type: Schema.Types.ObjectId, default: null },
      suggestedStructure: { type: [outlineNodeSchema], default: [] },
      detectedMetadata: { type: Schema.Types.Mixed, default: null },
      warnings: { type: [String], default: [] },
      error: { type: String, default: null },
    },
    status: { type: String, enum: OUTLINE_STATUSES, default: 'draft' },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
courseOutlineSchema.index({ institutionId: 1, courseId: 1, version: -1 }, { unique: true });
courseOutlineSchema.index({ institutionId: 1, status: 1, updatedAt: -1 });
courseOutlineSchema.plugin(tenantScopedPlugin);
