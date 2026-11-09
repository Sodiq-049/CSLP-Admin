import { z } from 'zod';
import { INSTITUTION_STATUSES, PROGRAMME_AWARDS } from '@cslp/shared-types';
import {
  AuditStampsSchema,
  EntityNameSchema,
  ObjectIdSchema,
  PageQuerySchema,
  ShortCodeSchema,
} from './common.js';
import { requestContract, responseContract } from './registry.js';

/* ───────────── Institutions ───────────── */

export const InstitutionSettingsSchema = z.object({
  defaultLocale: z.string().default('en-NG'),
  aiMonthlyBudgetUsd: z.number().min(0).default(0),
  videoMonthlyBudgetUsd: z.number().min(0).default(0),
  studentAiChatEnabled: z.boolean().default(false),
});

export const CreateInstitutionSchema = requestContract(
  'CreateInstitutionRequest',
  z.object({
    name: EntityNameSchema,
    shortName: z.string().trim().min(2).max(30),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and hyphens')
      .max(60),
    country: z.string().trim().length(2).toUpperCase().default('NG'),
    city: z.string().trim().max(100).optional(),
    timezone: z.string().trim().default('Africa/Lagos'),
    settings: InstitutionSettingsSchema.partial().optional(),
  }),
);
export type CreateInstitutionRequest = z.input<typeof CreateInstitutionSchema>;

export const UpdateInstitutionSchema = requestContract(
  'UpdateInstitutionRequest',
  CreateInstitutionSchema.omit({ slug: true }).partial(),
);

export const InstitutionSchema = responseContract(
  'Institution',
  z
    .object({
      id: ObjectIdSchema,
      name: z.string(),
      shortName: z.string(),
      slug: z.string(),
      country: z.string(),
      city: z.string().nullable(),
      timezone: z.string(),
      status: z.enum(INSTITUTION_STATUSES),
      settings: InstitutionSettingsSchema,
    })
    .extend(AuditStampsSchema.shape),
);
export type Institution = z.infer<typeof InstitutionSchema>;

/* ───────────── Faculties ───────────── */

export const CreateFacultySchema = requestContract(
  'CreateFacultyRequest',
  z.object({ name: EntityNameSchema, code: ShortCodeSchema.optional() }),
);
export const UpdateFacultySchema = requestContract(
  'UpdateFacultyRequest',
  CreateFacultySchema.partial(),
);
export const FacultySchema = responseContract(
  'Faculty',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      name: z.string(),
      code: z.string().nullable(),
      orderKey: z.string(),
    })
    .extend(AuditStampsSchema.shape),
);
export type Faculty = z.infer<typeof FacultySchema>;

/* ───────────── Departments ───────────── */

export const CreateDepartmentSchema = requestContract(
  'CreateDepartmentRequest',
  z.object({ facultyId: ObjectIdSchema, name: EntityNameSchema, code: ShortCodeSchema }),
);
export const UpdateDepartmentSchema = requestContract(
  'UpdateDepartmentRequest',
  CreateDepartmentSchema.omit({ facultyId: true }).partial(),
);
export const DepartmentSchema = responseContract(
  'Department',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      facultyId: ObjectIdSchema,
      name: z.string(),
      code: z.string(),
      orderKey: z.string(),
    })
    .extend(AuditStampsSchema.shape),
);
export type Department = z.infer<typeof DepartmentSchema>;

/* ───────────── Programmes ───────────── */

export const CreateProgrammeSchema = requestContract(
  'CreateProgrammeRequest',
  z.object({
    departmentId: ObjectIdSchema,
    name: EntityNameSchema,
    award: z.enum(PROGRAMME_AWARDS),
    code: ShortCodeSchema,
    durationLevels: z.number().int().min(1).max(8).default(2),
  }),
);
export const UpdateProgrammeSchema = requestContract(
  'UpdateProgrammeRequest',
  CreateProgrammeSchema.omit({ departmentId: true }).partial(),
);
export const ProgrammeSchema = responseContract(
  'Programme',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      facultyId: ObjectIdSchema,
      departmentId: ObjectIdSchema,
      name: z.string(),
      award: z.enum(PROGRAMME_AWARDS),
      code: z.string(),
      durationLevels: z.number().int(),
    })
    .extend(AuditStampsSchema.shape),
);
export type Programme = z.infer<typeof ProgrammeSchema>;

/* ───────────── Academic levels (belong to a programme) ───────────── */

export const CreateLevelSchema = requestContract(
  'CreateLevelRequest',
  z.object({
    name: z.string().trim().min(1).max(50),
    code: ShortCodeSchema,
    rank: z.number().int().min(1).max(20),
  }),
);
export const UpdateLevelSchema = requestContract('UpdateLevelRequest', CreateLevelSchema.partial());
export const LevelSchema = responseContract(
  'AcademicLevel',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      programmeId: ObjectIdSchema,
      name: z.string(),
      code: z.string(),
      rank: z.number().int(),
    })
    .extend(AuditStampsSchema.shape),
);
export type AcademicLevel = z.infer<typeof LevelSchema>;

/* ───────────── Semesters (institution-wide) ───────────── */

export const CreateSemesterSchema = requestContract(
  'CreateSemesterRequest',
  z.object({
    name: z.string().trim().min(1).max(50),
    code: ShortCodeSchema,
    rank: z.number().int().min(1).max(10),
  }),
);
export const UpdateSemesterSchema = requestContract(
  'UpdateSemesterRequest',
  CreateSemesterSchema.partial(),
);
export const SemesterSchema = responseContract(
  'Semester',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      name: z.string(),
      code: z.string(),
      rank: z.number().int(),
    })
    .extend(AuditStampsSchema.shape),
);
export type Semester = z.infer<typeof SemesterSchema>;

/* ───────────── Curriculum versions ───────────── */

export const CreateCurriculumVersionSchema = requestContract(
  'CreateCurriculumVersionRequest',
  z.object({
    programmeId: ObjectIdSchema.optional(),
    label: z.string().trim().min(2).max(100),
    effectiveFromSession: z
      .string()
      .regex(/^\d{4}\/\d{4}$/, 'Expected an academic session like 2024/2025'),
    isCurrent: z.boolean().default(false),
    notes: z.string().max(2000).optional(),
  }),
);
export const UpdateCurriculumVersionSchema = requestContract(
  'UpdateCurriculumVersionRequest',
  CreateCurriculumVersionSchema.omit({ programmeId: true }).partial(),
);
export const CurriculumVersionSchema = responseContract(
  'CurriculumVersion',
  z
    .object({
      id: ObjectIdSchema,
      institutionId: ObjectIdSchema,
      programmeId: ObjectIdSchema.nullable(),
      label: z.string(),
      effectiveFromSession: z.string(),
      isCurrent: z.boolean(),
      notes: z.string().nullable(),
    })
    .extend(AuditStampsSchema.shape),
);
export type CurriculumVersion = z.infer<typeof CurriculumVersionSchema>;

/* ───────────── Academic tree (pickers) ───────────── */

export const AcademicTreeSchema = responseContract(
  'AcademicTree',
  z.object({
    institution: z.object({ id: ObjectIdSchema, name: z.string(), shortName: z.string() }),
    semesters: z.array(z.object({ id: ObjectIdSchema, name: z.string(), code: z.string() })),
    faculties: z.array(
      z.object({
        id: ObjectIdSchema,
        name: z.string(),
        departments: z.array(
          z.object({
            id: ObjectIdSchema,
            name: z.string(),
            code: z.string(),
            programmes: z.array(
              z.object({
                id: ObjectIdSchema,
                name: z.string(),
                award: z.enum(PROGRAMME_AWARDS),
                code: z.string(),
                levels: z.array(
                  z.object({ id: ObjectIdSchema, name: z.string(), code: z.string() }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);
export type AcademicTree = z.infer<typeof AcademicTreeSchema>;

export const ListQuerySchema = PageQuerySchema;

export const DepartmentListQuerySchema = PageQuerySchema.extend({
  facultyId: ObjectIdSchema.optional(),
});
export const ProgrammeListQuerySchema = PageQuerySchema.extend({
  departmentId: ObjectIdSchema.optional(),
});
