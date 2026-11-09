import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import {
  normaliseCourseCode,
  type Course,
  type CourseListQuerySchema,
  type CreateCourseSchema,
  type UpdateCourseSchema,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError, duplicateKeyFields } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import type {
  AcademicLevelDoc,
  CurriculumVersionDoc,
  DepartmentDoc,
  ProgrammeDoc,
  SemesterDoc,
} from '../academic/academic.schemas.js';
import type { CourseDoc, Objective, TopicDoc } from './course.schemas.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DUPLICATE = () =>
  new AppError(
    'DUPLICATE_COURSE_CODE',
    'A course with this code already exists in this programme and curriculum',
    [{ path: 'code', issue: 'duplicate' }],
  );

export const withObjectiveIds = (
  list: { id?: string; text: string }[],
  source: Objective['source'],
): Objective[] => list.map((o) => ({ id: o.id ?? randomUUID().slice(0, 8), text: o.text, source }));

@Injectable()
export class CoursesService {
  constructor(
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    @InjectModel(MODELS.Semester) private readonly semesters: Model<SemesterDoc>,
    @InjectModel(MODELS.Department) private readonly departments: Model<DepartmentDoc>,
    @InjectModel(MODELS.CurriculumVersion) private readonly curricula: Model<CurriculumVersionDoc>,
    private readonly audit: AuditLogService,
  ) {}

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const c = await this.courses
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return c ? String(c.institutionId) : null;
  }

  async load(scope: TenantScope, id: string): Promise<CourseDoc> {
    const institutionId = await this.resolveInstitutionId(id);
    if (!institutionId) throw AppError.notFound('Course');
    assertInstitutionAccess(scope, institutionId);
    const c = await this.courses
      .findOne({ _id: oid(id), institutionId: oid(institutionId) })
      .lean<CourseDoc>();
    if (!c) throw AppError.notFound('Course');
    return c;
  }

  /** Programme, level, semester and curriculum must be active and belong together (docs/02 §4). */
  private async resolvePlacement(
    scope: TenantScope,
    input: {
      programmeId: string;
      levelId: string;
      semesterId: string;
      curriculumVersionId?: string | null;
    },
  ) {
    const programme = await this.programmes
      .findOne({ _id: oid(input.programmeId), archivedAt: null })
      .setOptions({ crossTenant: true })
      .lean<ProgrammeDoc>();
    if (!programme)
      throw new AppError('VALIDATION_FAILED', 'Programme not found', [
        { path: 'programmeId', issue: 'not_found' },
      ]);
    assertInstitutionAccess(scope, programme.institutionId);
    const inst = programme.institutionId;
    const level = await this.levels
      .findOne({
        _id: oid(input.levelId),
        institutionId: inst,
        programmeId: programme._id,
        archivedAt: null,
      })
      .lean();
    if (!level)
      throw new AppError('VALIDATION_FAILED', 'Level does not belong to this programme', [
        { path: 'levelId', issue: 'not_found' },
      ]);
    const semester = await this.semesters
      .findOne({ _id: oid(input.semesterId), institutionId: inst, archivedAt: null })
      .lean();
    if (!semester)
      throw new AppError('VALIDATION_FAILED', 'Semester not found in this institution', [
        { path: 'semesterId', issue: 'not_found' },
      ]);
    let curriculumVersionId: Types.ObjectId | null = null;
    if (input.curriculumVersionId) {
      const cv = await this.curricula
        .findOne({ _id: oid(input.curriculumVersionId), institutionId: inst })
        .lean<CurriculumVersionDoc>();
      if (!cv || (cv.programmeId && String(cv.programmeId) !== String(programme._id))) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Curriculum version does not apply to this programme',
          [{ path: 'curriculumVersionId', issue: 'not_found' }],
        );
      }
      curriculumVersionId = cv._id;
    }
    return { programme, curriculumVersionId };
  }

  async create(
    actor: Actor,
    scope: TenantScope,
    input: z.output<typeof CreateCourseSchema>,
  ): Promise<CourseDoc> {
    const { programme, curriculumVersionId } = await this.resolvePlacement(scope, input);
    try {
      const doc = await this.courses.create({
        institutionId: programme.institutionId,
        facultyId: programme.facultyId,
        departmentId: programme.departmentId,
        programmeId: programme._id,
        levelId: oid(input.levelId),
        semesterId: oid(input.semesterId),
        curriculumVersionId,
        code: input.code.trim().toUpperCase().replace(/\s+/g, ' '),
        codeNormalized: normaliseCourseCode(input.code),
        title: input.title,
        creditUnits: input.creditUnits,
        description: input.description,
        // Course objectives are entered by staff from the official outline (AI never writes 'official').
        objectives: withObjectiveIds(input.objectives, 'official'),
        prerequisites: input.prerequisites.map((p) => ({
          courseId: p.courseId ? oid(p.courseId) : null,
          text: p.text,
        })),
        references: input.references.map((r) => ({
          citation: r.citation,
          url: r.url ?? null,
          isbn: r.isbn ?? null,
        })),
        isDemoData: input.isDemoData,
        createdBy: actor.userId ? oid(actor.userId) : null,
        updatedBy: actor.userId ? oid(actor.userId) : null,
      });
      const obj = doc.toObject() as CourseDoc;
      await this.audit.record({
        actor,
        action: 'course.create',
        target: { type: 'course', id: obj._id },
        institutionId: obj.institutionId,
        after: obj,
      });
      return obj;
    } catch (err) {
      if (duplicateKeyFields(err)) throw DUPLICATE();
      throw err;
    }
  }

  async update(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof UpdateCourseSchema>,
  ): Promise<CourseDoc> {
    const before = await this.load(scope, id);
    if (before.archivedAt) throw AppError.conflict('Archived courses cannot be edited');
    const set: Record<string, unknown> = { updatedBy: actor.userId ? oid(actor.userId) : null };
    if (input.levelId || input.semesterId || input.curriculumVersionId !== undefined) {
      const placement = await this.resolvePlacement(scope, {
        programmeId: String(before.programmeId),
        levelId: input.levelId ?? String(before.levelId),
        semesterId: input.semesterId ?? String(before.semesterId),
        curriculumVersionId:
          input.curriculumVersionId ??
          (before.curriculumVersionId ? String(before.curriculumVersionId) : null),
      });
      if (input.levelId) set.levelId = oid(input.levelId);
      if (input.semesterId) set.semesterId = oid(input.semesterId);
      set.curriculumVersionId = placement.curriculumVersionId;
    }
    if (input.code !== undefined) {
      set.code = input.code.trim().toUpperCase().replace(/\s+/g, ' ');
      set.codeNormalized = normaliseCourseCode(input.code);
    }
    for (const k of ['title', 'creditUnits', 'description'] as const)
      if (input[k] !== undefined) set[k] = input[k];
    if (input.objectives) set.objectives = withObjectiveIds(input.objectives, 'official');
    if (input.prerequisites)
      set.prerequisites = input.prerequisites.map((p) => ({
        courseId: p.courseId ? oid(p.courseId) : null,
        text: p.text,
      }));
    if (input.references)
      set.references = input.references.map((r) => ({
        citation: r.citation,
        url: r.url ?? null,
        isbn: r.isbn ?? null,
      }));
    try {
      const after = await this.courses
        .findOneAndUpdate(
          { _id: before._id, institutionId: before.institutionId },
          { $set: set },
          { returnDocument: 'after', runValidators: true },
        )
        .lean<CourseDoc>();
      await this.audit.record({
        actor,
        action: 'course.update',
        target: { type: 'course', id },
        institutionId: before.institutionId,
        before,
        after,
      });
      return after!;
    } catch (err) {
      if (duplicateKeyFields(err)) throw DUPLICATE();
      throw err;
    }
  }

  async archive(actor: Actor, scope: TenantScope, id: string): Promise<CourseDoc> {
    const c = await this.load(scope, id);
    const after = await this.courses
      .findOneAndUpdate(
        { _id: c._id, institutionId: c.institutionId },
        { $set: { archivedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<CourseDoc>();
    await this.audit.record({
      actor,
      action: 'course.archive',
      target: { type: 'course', id },
      institutionId: c.institutionId,
    });
    return after!;
  }

  async list(
    scope: TenantScope,
    q: z.output<typeof CourseListQuerySchema>,
  ): Promise<{ items: CourseDoc[]; total: number }> {
    const f: Record<string, unknown> = { ...institutionFilter(scope, q.institutionId) };
    for (const k of ['departmentId', 'programmeId', 'levelId', 'semesterId'] as const)
      if (q[k]) f[k] = oid(q[k]!);
    if (q.publication) f['publication.state'] = q.publication;
    if (!q.includeArchived) f.archivedAt = null;
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      f.$or = [
        { title: rx },
        { code: rx },
        { codeNormalized: new RegExp(escapeRegex(normaliseCourseCode(q.q)), 'i') },
      ];
    }
    const [items, total] = await Promise.all([
      this.courses
        .find(f)
        .sort({ codeNormalized: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<CourseDoc[]>(),
      this.courses.countDocuments(f),
    ]);
    return { items, total };
  }

  /** DTOs with display labels and topic counts, batched for a page of courses. */
  async toDtos(items: CourseDoc[]): Promise<Course[]> {
    if (!items.length) return [];
    const inst = {
      institutionId: { $in: [...new Set(items.map((c) => String(c.institutionId)))].map(oid) },
    };
    const ids = (k: keyof CourseDoc) => ({
      ...inst,
      _id: { $in: items.map((c) => c[k] as Types.ObjectId) },
    });
    const [programmes, levels, semesters, departments, counts] = await Promise.all([
      this.programmes.find(ids('programmeId'), { name: 1, award: 1 }).lean<ProgrammeDoc[]>(),
      this.levels.find(ids('levelId'), { name: 1 }).lean<AcademicLevelDoc[]>(),
      this.semesters.find(ids('semesterId'), { name: 1 }).lean<SemesterDoc[]>(),
      this.departments.find(ids('departmentId'), { name: 1 }).lean<DepartmentDoc[]>(),
      this.topics.aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            ...inst,
            courseId: { $in: items.map((c) => c._id) },
            archivedAt: null,
            depth: 0,
          },
        },
        { $group: { _id: '$courseId', n: { $sum: 1 } } },
      ]),
    ]);
    const name = (list: { _id: Types.ObjectId; name: string }[]) =>
      new Map(list.map((x) => [String(x._id), x.name]));
    const [pn, ln, sn, dn] = [name(programmes), name(levels), name(semesters), name(departments)];
    const cn = new Map(counts.map((c) => [String(c._id), c.n]));
    return items.map((c) =>
      toCourseDto(
        c,
        {
          programme: pn.get(String(c.programmeId)) ?? '—',
          level: ln.get(String(c.levelId)) ?? '—',
          semester: sn.get(String(c.semesterId)) ?? '—',
          department: dn.get(String(c.departmentId)) ?? '—',
        },
        cn.get(String(c._id)) ?? 0,
      ),
    );
  }
}

export function toCourseDto(c: CourseDoc, labels: Course['labels'], topicCount: number): Course {
  return {
    id: String(c._id),
    institutionId: String(c.institutionId),
    facultyId: String(c.facultyId),
    departmentId: String(c.departmentId),
    programmeId: String(c.programmeId),
    levelId: String(c.levelId),
    semesterId: String(c.semesterId),
    curriculumVersionId: c.curriculumVersionId ? String(c.curriculumVersionId) : null,
    code: c.code,
    codeNormalized: c.codeNormalized,
    title: c.title,
    creditUnits: c.creditUnits,
    description: c.description,
    objectives: c.objectives.map((o) => ({ id: o.id, text: o.text, source: o.source })),
    prerequisites: c.prerequisites.map((p) => ({
      courseId: p.courseId ? String(p.courseId) : null,
      text: p.text,
    })),
    references: c.references.map((r) => ({
      citation: r.citation,
      url: r.url ?? null,
      isbn: r.isbn ?? null,
    })),
    activeOutlineId: c.activeOutlineId ? String(c.activeOutlineId) : null,
    isDemoData: c.isDemoData,
    publication: {
      state: c.publication.state,
      publishedAt: c.publication.publishedAt?.toISOString() ?? null,
    },
    topicCount,
    labels,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}
