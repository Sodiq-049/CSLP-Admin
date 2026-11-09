import { Schema, Types } from 'mongoose';
import {
  INSTITUTION_STATUSES,
  PROGRAMME_AWARDS,
  type InstitutionStatus,
  type ProgrammeAward,
} from '@cslp/shared-types';
import { archivableFields, baseSchemaOptions } from '../database/schema-options.js';
import { tenantScopedPlugin } from '../database/tenant-plugin.js';

interface Stamps {
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
const notArchived = { partialFilterExpression: { archivedAt: null } };

/* ───────── institutions (the tenant itself; not tenant-plugin scoped) ───────── */
export interface InstitutionDoc extends Stamps {
  _id: Types.ObjectId;
  name: string;
  shortName: string;
  slug: string;
  country: string;
  city: string | null;
  timezone: string;
  status: InstitutionStatus;
  settings: {
    defaultLocale: string;
    aiMonthlyBudgetUsd: number;
    videoMonthlyBudgetUsd: number;
    studentAiChatEnabled: boolean;
  };
}
export const institutionSchema = new Schema<InstitutionDoc>(
  {
    name: { type: String, required: true, trim: true },
    shortName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true },
    country: { type: String, default: 'NG' },
    city: { type: String, default: null },
    timezone: { type: String, default: 'Africa/Lagos' },
    status: { type: String, enum: INSTITUTION_STATUSES, default: 'active' },
    settings: {
      defaultLocale: { type: String, default: 'en-NG' },
      aiMonthlyBudgetUsd: { type: Number, default: 0 },
      videoMonthlyBudgetUsd: { type: Number, default: 0 },
      studentAiChatEnabled: { type: Boolean, default: false },
    },
    ...archivableFields,
  },
  baseSchemaOptions,
);
institutionSchema.index({ slug: 1 }, { unique: true });

/* ───────── faculties ───────── */
export interface FacultyDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  name: string;
  code: string | null;
  orderKey: string;
}
export const facultySchema = new Schema<FacultyDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: null },
    orderKey: { type: String, required: true },
    ...archivableFields,
  },
  baseSchemaOptions,
);
facultySchema.index({ institutionId: 1, name: 1 }, { unique: true, ...notArchived });
facultySchema.index({ institutionId: 1, orderKey: 1 });
facultySchema.plugin(tenantScopedPlugin);

/* ───────── departments ───────── */
export interface DepartmentDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  facultyId: Types.ObjectId;
  name: string;
  code: string;
  orderKey: string;
}
export const departmentSchema = new Schema<DepartmentDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    facultyId: { type: Schema.Types.ObjectId, ref: 'Faculty', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    orderKey: { type: String, required: true },
    ...archivableFields,
  },
  baseSchemaOptions,
);
departmentSchema.index({ institutionId: 1, code: 1 }, { unique: true, ...notArchived });
departmentSchema.index({ institutionId: 1, facultyId: 1, orderKey: 1 });
departmentSchema.plugin(tenantScopedPlugin);

/* ───────── programmes ───────── */
export interface ProgrammeDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  facultyId: Types.ObjectId;
  departmentId: Types.ObjectId;
  name: string;
  award: ProgrammeAward;
  code: string;
  durationLevels: number;
}
export const programmeSchema = new Schema<ProgrammeDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    facultyId: { type: Schema.Types.ObjectId, ref: 'Faculty', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    name: { type: String, required: true, trim: true },
    award: { type: String, enum: PROGRAMME_AWARDS, required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    durationLevels: { type: Number, default: 2 },
    ...archivableFields,
  },
  baseSchemaOptions,
);
programmeSchema.index(
  { institutionId: 1, departmentId: 1, code: 1 },
  { unique: true, ...notArchived },
);
programmeSchema.plugin(tenantScopedPlugin);

/* ───────── academic levels ───────── */
export interface AcademicLevelDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  programmeId: Types.ObjectId;
  name: string;
  code: string;
  rank: number;
}
export const academicLevelSchema = new Schema<AcademicLevelDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    programmeId: { type: Schema.Types.ObjectId, ref: 'Programme', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    rank: { type: Number, required: true },
    ...archivableFields,
  },
  baseSchemaOptions,
);
academicLevelSchema.index(
  { institutionId: 1, programmeId: 1, code: 1 },
  { unique: true, ...notArchived },
);
academicLevelSchema.index({ institutionId: 1, programmeId: 1, rank: 1 });
academicLevelSchema.plugin(tenantScopedPlugin);

/* ───────── semesters ───────── */
export interface SemesterDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  name: string;
  code: string;
  rank: number;
}
export const semesterSchema = new Schema<SemesterDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    rank: { type: Number, required: true },
    ...archivableFields,
  },
  baseSchemaOptions,
);
semesterSchema.index({ institutionId: 1, code: 1 }, { unique: true, ...notArchived });
semesterSchema.plugin(tenantScopedPlugin);

/* ───────── curriculum versions ───────── */
export interface CurriculumVersionDoc extends Stamps {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  programmeId: Types.ObjectId | null;
  label: string;
  effectiveFromSession: string;
  isCurrent: boolean;
  notes: string | null;
}
export const curriculumVersionSchema = new Schema<CurriculumVersionDoc>(
  {
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', required: true },
    programmeId: { type: Schema.Types.ObjectId, ref: 'Programme', default: null },
    label: { type: String, required: true, trim: true },
    effectiveFromSession: { type: String, required: true },
    isCurrent: { type: Boolean, default: false },
    notes: { type: String, default: null },
    ...archivableFields,
  },
  baseSchemaOptions,
);
curriculumVersionSchema.index({ institutionId: 1, programmeId: 1, label: 1 }, { unique: true });
curriculumVersionSchema.plugin(tenantScopedPlugin);
