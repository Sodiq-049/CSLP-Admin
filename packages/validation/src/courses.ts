import { z } from 'zod';
import { PUBLICATION_STATES } from '@cslp/shared-types';
import { IsoDateSchema, ObjectIdSchema, PageQuerySchema } from './common.js';
import { requestContract, responseContract } from './registry.js';

/** Loose guard; formats vary by institution (docs/04 §4). Stored as a string, never a number. */
export const CourseCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z]{2,6}\s?-?\d{2,4}[A-Za-z]?$/, 'Expected a course code like "COM 101"');

export const normaliseCourseCode = (code: string) => code.toUpperCase().replace(/[\s-]+/g, '');

const ObjectiveInput = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(3).max(500),
});
const PrerequisiteInput = z.object({
  courseId: ObjectIdSchema.optional(),
  text: z.string().trim().min(2).max(300),
});
const ReferenceInput = z.object({
  citation: z.string().trim().min(3).max(500),
  url: z.string().url().optional(),
  isbn: z.string().trim().max(20).optional(),
});

export const CreateCourseSchema = requestContract(
  'CreateCourseRequest',
  z.object({
    programmeId: ObjectIdSchema,
    levelId: ObjectIdSchema,
    semesterId: ObjectIdSchema,
    curriculumVersionId: ObjectIdSchema.optional(),
    code: CourseCodeSchema,
    title: z.string().trim().min(3).max(200),
    creditUnits: z.number().int().min(0).max(30),
    description: z.string().max(5000).default(''),
    objectives: z.array(ObjectiveInput).max(30).default([]),
    prerequisites: z.array(PrerequisiteInput).max(20).default([]),
    references: z.array(ReferenceInput).max(50).default([]),
    isDemoData: z.boolean().default(false),
  }),
);
export type CreateCourseRequest = z.input<typeof CreateCourseSchema>;

export const UpdateCourseSchema = requestContract(
  'UpdateCourseRequest',
  CreateCourseSchema.omit({ programmeId: true, isDemoData: true }).partial(),
);

export const CourseListQuerySchema = PageQuerySchema.extend({
  institutionId: ObjectIdSchema.optional(),
  departmentId: ObjectIdSchema.optional(),
  programmeId: ObjectIdSchema.optional(),
  levelId: ObjectIdSchema.optional(),
  semesterId: ObjectIdSchema.optional(),
  publication: z.enum(PUBLICATION_STATES).optional(),
});

export const CourseSchema = responseContract(
  'Course',
  z.object({
    id: ObjectIdSchema,
    institutionId: ObjectIdSchema,
    facultyId: ObjectIdSchema,
    departmentId: ObjectIdSchema,
    programmeId: ObjectIdSchema,
    levelId: ObjectIdSchema,
    semesterId: ObjectIdSchema,
    curriculumVersionId: ObjectIdSchema.nullable(),
    code: z.string(),
    codeNormalized: z.string(),
    title: z.string(),
    creditUnits: z.number().int(),
    description: z.string(),
    objectives: z.array(
      z.object({ id: z.string(), text: z.string(), source: z.enum(['official', 'admin']) }),
    ),
    prerequisites: z.array(z.object({ courseId: ObjectIdSchema.nullable(), text: z.string() })),
    references: z.array(
      z.object({ citation: z.string(), url: z.string().nullable(), isbn: z.string().nullable() }),
    ),
    activeOutlineId: ObjectIdSchema.nullable(),
    isDemoData: z.boolean(),
    publication: z.object({
      state: z.enum(PUBLICATION_STATES),
      publishedAt: IsoDateSchema.nullable(),
    }),
    topicCount: z.number().int(),
    labels: z.object({
      programme: z.string(),
      level: z.string(),
      semester: z.string(),
      department: z.string(),
    }),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    archivedAt: IsoDateSchema.nullable(),
  }),
);
export type Course = z.infer<typeof CourseSchema>;
