import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type {
  AcademicTree,
  CreateCurriculumVersionSchema,
  CreateDepartmentSchema,
  CreateFacultySchema,
  CreateLevelSchema,
  CreateProgrammeSchema,
  CreateSemesterSchema,
  PageQuery,
  UpdateCurriculumVersionSchema,
  UpdateDepartmentSchema,
  UpdateFacultySchema,
  UpdateLevelSchema,
  UpdateProgrammeSchema,
  UpdateSemesterSchema,
} from '@cslp/validation';
import { AppError, duplicateKeyFields } from '../errors/app-error.js';
import { MODELS } from '../database/model-names.js';
import { orderKeyBetween } from '../database/order-key.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import { assertInstitutionAccess, type TenantScope } from '../tenancy/tenant-scope.js';
import type {
  AcademicLevelDoc,
  CurriculumVersionDoc,
  DepartmentDoc,
  FacultyDoc,
  InstitutionDoc,
  ProgrammeDoc,
  SemesterDoc,
} from './academic.schemas.js';

type Out<T extends z.ZodType> = z.output<T>;
export type AcademicEntityType =
  'faculty' | 'department' | 'programme' | 'level' | 'semester' | 'curriculumVersion';

interface Paged<T> {
  items: T[];
  total: number;
}
interface TenantDoc {
  _id: Types.ObjectId;
  institutionId: Types.ObjectId;
  archivedAt: Date | null;
}

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Institution → Faculty → Department → Programme → Level, plus Semesters and Curriculum versions
 * (docs/02 §4). Every method takes a TenantScope; ancestors are validated to belong to the same
 * institution so ids from another tenant can never be attached.
 */
@Injectable()
export class AcademicStructureService {
  constructor(
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    @InjectModel(MODELS.Faculty) private readonly faculties: Model<FacultyDoc>,
    @InjectModel(MODELS.Department) private readonly departments: Model<DepartmentDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    @InjectModel(MODELS.Semester) private readonly semesters: Model<SemesterDoc>,
    @InjectModel(MODELS.CurriculumVersion) private readonly curricula: Model<CurriculumVersionDoc>,
    private readonly audit: AuditLogService,
  ) {}

  /* ───────────────────────── shared helpers ───────────────────────── */

  private modelFor(type: AcademicEntityType): Model<TenantDoc> {
    const map: Record<AcademicEntityType, unknown> = {
      faculty: this.faculties,
      department: this.departments,
      programme: this.programmes,
      level: this.levels,
      semester: this.semesters,
      curriculumVersion: this.curricula,
    };
    return map[type] as unknown as Model<TenantDoc>;
  }

  /**
   * Trusted scope resolution: which institution owns this entity? Used by the API's scope guard
   * before permission checks. The only cross-tenant read in this service.
   */
  async resolveInstitutionId(type: AcademicEntityType, id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.modelFor(type)
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return doc ? String(doc.institutionId) : null;
  }

  private async assertActiveInstitution(scope: TenantScope, institutionId: string): Promise<void> {
    if (!Types.ObjectId.isValid(institutionId)) throw AppError.notFound('Institution');
    assertInstitutionAccess(scope, institutionId);
    const inst = await this.institutions.exists({ _id: oid(institutionId), archivedAt: null });
    if (!inst) throw AppError.notFound('Institution');
  }

  private async loadScoped<T extends TenantDoc>(
    type: AcademicEntityType,
    scope: TenantScope,
    id: string,
    label: string,
  ): Promise<T> {
    const institutionId = await this.resolveInstitutionId(type, id);
    if (!institutionId) throw AppError.notFound(label);
    assertInstitutionAccess(scope, institutionId);
    const doc = await this.modelFor(type)
      .findOne({ _id: oid(id), institutionId: oid(institutionId) })
      .lean<T>();
    if (!doc) throw AppError.notFound(label);
    return doc;
  }

  /** Parent must exist, be active and belong to the same institution. */
  private async loadParent<T extends TenantDoc>(
    type: AcademicEntityType,
    institutionId: string,
    id: string,
    label: string,
    path: string,
  ): Promise<T> {
    if (!Types.ObjectId.isValid(id))
      throw new AppError('VALIDATION_FAILED', `Invalid ${label}`, [{ path, issue: 'invalid' }]);
    const doc = await this.modelFor(type)
      .findOne({ _id: oid(id), institutionId: oid(institutionId), archivedAt: null })
      .lean<T>();
    if (!doc)
      throw new AppError('VALIDATION_FAILED', `${label} not found in this institution`, [
        { path, issue: 'not_found' },
      ]);
    return doc;
  }

  private async nextOrderKey(
    model: Model<TenantDoc>,
    filter: Record<string, unknown>,
  ): Promise<string> {
    const last = await model
      .findOne(filter, { orderKey: 1 })
      .sort({ orderKey: -1 })
      .lean<{ orderKey?: string }>();
    return orderKeyBetween(last?.orderKey ?? null, null);
  }

  private async insert<T extends TenantDoc>(
    actor: Actor,
    type: AcademicEntityType,
    data: Record<string, unknown>,
    duplicateMessage: string,
  ): Promise<T> {
    try {
      const doc = await this.modelFor(type).create(data);
      const obj = doc.toObject() as unknown as T;
      await this.audit.record({
        actor,
        action: `academic.${type}.create`,
        target: { type, id: obj._id },
        institutionId: obj.institutionId,
        after: obj,
      });
      return obj;
    } catch (err) {
      const fields = duplicateKeyFields(err);
      if (fields)
        throw AppError.conflict(
          duplicateMessage,
          fields.filter((f) => f !== 'institutionId').map((path) => ({ path, issue: 'duplicate' })),
        );
      throw err;
    }
  }

  private async patch<T extends TenantDoc>(
    actor: Actor,
    type: AcademicEntityType,
    before: T,
    input: Record<string, unknown>,
    duplicateMessage: string,
  ): Promise<T> {
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    try {
      const after = await this.modelFor(type)
        .findOneAndUpdate(
          { _id: before._id, institutionId: before.institutionId },
          { $set: set },
          { returnDocument: 'after', runValidators: true },
        )
        .lean<T>();
      if (!after) throw AppError.notFound();
      await this.audit.record({
        actor,
        action: `academic.${type}.update`,
        target: { type, id: before._id },
        institutionId: before.institutionId,
        before,
        after,
      });
      return after;
    } catch (err) {
      const fields = duplicateKeyFields(err);
      if (fields)
        throw AppError.conflict(
          duplicateMessage,
          fields.filter((f) => f !== 'institutionId').map((path) => ({ path, issue: 'duplicate' })),
        );
      throw err;
    }
  }

  private async setArchived<T extends TenantDoc>(
    actor: Actor,
    type: AcademicEntityType,
    doc: T,
  ): Promise<T> {
    const after = await this.modelFor(type)
      .findOneAndUpdate(
        { _id: doc._id, institutionId: doc.institutionId },
        { $set: { archivedAt: new Date() } },
        { returnDocument: 'after' },
      )
      .lean<T>();
    await this.audit.record({
      actor,
      action: `academic.${type}.archive`,
      target: { type, id: doc._id },
      institutionId: doc.institutionId,
    });
    return after!;
  }

  private async page<T>(
    model: Model<TenantDoc>,
    filter: Record<string, unknown>,
    query: PageQuery,
    sort: Record<string, 1 | -1>,
    searchFields: string[],
  ): Promise<Paged<T>> {
    const f: Record<string, unknown> = { ...filter };
    if (!query.includeArchived) f.archivedAt = null;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      f.$or = searchFields.map((field) => ({ [field]: rx }));
    }
    const [items, total] = await Promise.all([
      model
        .find(f)
        .sort(sort)
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<T[]>(),
      model.countDocuments(f),
    ]);
    return { items, total };
  }

  private async assertNoActiveChildren(
    model: Model<TenantDoc>,
    filter: Record<string, unknown>,
    message: string,
  ) {
    if (await model.exists({ ...filter, archivedAt: null })) throw AppError.conflict(message);
  }

  /* ───────────────────────── faculties ───────────────────────── */

  async listFaculties(
    scope: TenantScope,
    institutionId: string,
    q: PageQuery,
  ): Promise<Paged<FacultyDoc>> {
    await this.assertActiveInstitution(scope, institutionId);
    return this.page(
      this.faculties as never,
      { institutionId: oid(institutionId) },
      q,
      { orderKey: 1 },
      ['name', 'code'],
    );
  }

  async createFaculty(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    input: Out<typeof CreateFacultySchema>,
  ) {
    await this.assertActiveInstitution(scope, institutionId);
    const orderKey = await this.nextOrderKey(this.faculties as never, {
      institutionId: oid(institutionId),
    });
    return this.insert<FacultyDoc>(
      actor,
      'faculty',
      { institutionId: oid(institutionId), name: input.name, code: input.code ?? null, orderKey },
      'A faculty with this name already exists',
    );
  }

  async updateFaculty(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateFacultySchema>,
  ) {
    const before = await this.loadScoped<FacultyDoc>('faculty', scope, id, 'Faculty');
    return this.patch(actor, 'faculty', before, input, 'A faculty with this name already exists');
  }

  async archiveFaculty(actor: Actor, scope: TenantScope, id: string) {
    const doc = await this.loadScoped<FacultyDoc>('faculty', scope, id, 'Faculty');
    await this.assertNoActiveChildren(
      this.departments as never,
      { institutionId: doc.institutionId, facultyId: doc._id },
      'Archive or move this faculty’s departments first',
    );
    return this.setArchived(actor, 'faculty', doc);
  }

  /* ───────────────────────── departments ───────────────────────── */

  async listDepartments(
    scope: TenantScope,
    institutionId: string,
    q: PageQuery & { facultyId?: string },
  ): Promise<Paged<DepartmentDoc>> {
    await this.assertActiveInstitution(scope, institutionId);
    const filter: Record<string, unknown> = { institutionId: oid(institutionId) };
    if (q.facultyId && Types.ObjectId.isValid(q.facultyId)) filter.facultyId = oid(q.facultyId);
    return this.page(this.departments as never, filter, q, { orderKey: 1 }, ['name', 'code']);
  }

  async createDepartment(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    input: Out<typeof CreateDepartmentSchema>,
  ) {
    await this.assertActiveInstitution(scope, institutionId);
    const faculty = await this.loadParent<FacultyDoc>(
      'faculty',
      institutionId,
      input.facultyId,
      'Faculty',
      'facultyId',
    );
    const orderKey = await this.nextOrderKey(this.departments as never, {
      institutionId: oid(institutionId),
      facultyId: faculty._id,
    });
    return this.insert<DepartmentDoc>(
      actor,
      'department',
      {
        institutionId: oid(institutionId),
        facultyId: faculty._id,
        name: input.name,
        code: input.code,
        orderKey,
      },
      'A department with this code already exists in this institution',
    );
  }

  async updateDepartment(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateDepartmentSchema>,
  ) {
    const before = await this.loadScoped<DepartmentDoc>('department', scope, id, 'Department');
    return this.patch(
      actor,
      'department',
      before,
      input,
      'A department with this code already exists in this institution',
    );
  }

  async archiveDepartment(actor: Actor, scope: TenantScope, id: string) {
    const doc = await this.loadScoped<DepartmentDoc>('department', scope, id, 'Department');
    await this.assertNoActiveChildren(
      this.programmes as never,
      { institutionId: doc.institutionId, departmentId: doc._id },
      'Archive this department’s programmes first',
    );
    return this.setArchived(actor, 'department', doc);
  }

  /* ───────────────────────── programmes ───────────────────────── */

  async listProgrammes(
    scope: TenantScope,
    institutionId: string,
    q: PageQuery & { departmentId?: string },
  ): Promise<Paged<ProgrammeDoc>> {
    await this.assertActiveInstitution(scope, institutionId);
    const filter: Record<string, unknown> = { institutionId: oid(institutionId) };
    if (q.departmentId && Types.ObjectId.isValid(q.departmentId))
      filter.departmentId = oid(q.departmentId);
    return this.page(this.programmes as never, filter, q, { name: 1 }, ['name', 'code']);
  }

  async createProgramme(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    input: Out<typeof CreateProgrammeSchema>,
  ) {
    await this.assertActiveInstitution(scope, institutionId);
    const dept = await this.loadParent<DepartmentDoc>(
      'department',
      institutionId,
      input.departmentId,
      'Department',
      'departmentId',
    );
    return this.insert<ProgrammeDoc>(
      actor,
      'programme',
      {
        institutionId: oid(institutionId),
        facultyId: dept.facultyId,
        departmentId: dept._id,
        name: input.name,
        award: input.award,
        code: input.code,
        durationLevels: input.durationLevels,
      },
      'A programme with this code already exists in this department',
    );
  }

  async updateProgramme(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateProgrammeSchema>,
  ) {
    const before = await this.loadScoped<ProgrammeDoc>('programme', scope, id, 'Programme');
    return this.patch(
      actor,
      'programme',
      before,
      input,
      'A programme with this code already exists in this department',
    );
  }

  /** Levels are part of a programme's configuration, so they are archived with it. */
  async archiveProgramme(actor: Actor, scope: TenantScope, id: string) {
    const doc = await this.loadScoped<ProgrammeDoc>('programme', scope, id, 'Programme');
    await this.levels.updateMany(
      { institutionId: doc.institutionId, programmeId: doc._id, archivedAt: null },
      { $set: { archivedAt: new Date() } },
    );
    return this.setArchived(actor, 'programme', doc);
  }

  /* ───────────────────────── levels ───────────────────────── */

  async listLevels(
    scope: TenantScope,
    programmeId: string,
    q: PageQuery,
  ): Promise<Paged<AcademicLevelDoc>> {
    const programme = await this.loadScoped<ProgrammeDoc>(
      'programme',
      scope,
      programmeId,
      'Programme',
    );
    return this.page(
      this.levels as never,
      { institutionId: programme.institutionId, programmeId: programme._id },
      q,
      { rank: 1 },
      ['name', 'code'],
    );
  }

  async createLevel(
    actor: Actor,
    scope: TenantScope,
    programmeId: string,
    input: Out<typeof CreateLevelSchema>,
  ) {
    const programme = await this.loadScoped<ProgrammeDoc>(
      'programme',
      scope,
      programmeId,
      'Programme',
    );
    if (programme.archivedAt) throw AppError.conflict('Programme is archived');
    return this.insert<AcademicLevelDoc>(
      actor,
      'level',
      { institutionId: programme.institutionId, programmeId: programme._id, ...input },
      'A level with this code already exists in this programme',
    );
  }

  async updateLevel(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateLevelSchema>,
  ) {
    const before = await this.loadScoped<AcademicLevelDoc>('level', scope, id, 'Level');
    return this.patch(
      actor,
      'level',
      before,
      input,
      'A level with this code already exists in this programme',
    );
  }

  async archiveLevel(actor: Actor, scope: TenantScope, id: string) {
    const doc = await this.loadScoped<AcademicLevelDoc>('level', scope, id, 'Level');
    return this.setArchived(actor, 'level', doc);
  }

  /* ───────────────────────── semesters ───────────────────────── */

  async listSemesters(
    scope: TenantScope,
    institutionId: string,
    q: PageQuery,
  ): Promise<Paged<SemesterDoc>> {
    await this.assertActiveInstitution(scope, institutionId);
    return this.page(
      this.semesters as never,
      { institutionId: oid(institutionId) },
      q,
      { rank: 1 },
      ['name', 'code'],
    );
  }

  async createSemester(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    input: Out<typeof CreateSemesterSchema>,
  ) {
    await this.assertActiveInstitution(scope, institutionId);
    return this.insert<SemesterDoc>(
      actor,
      'semester',
      { institutionId: oid(institutionId), ...input },
      'A semester with this code already exists',
    );
  }

  async updateSemester(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateSemesterSchema>,
  ) {
    const before = await this.loadScoped<SemesterDoc>('semester', scope, id, 'Semester');
    return this.patch(actor, 'semester', before, input, 'A semester with this code already exists');
  }

  async archiveSemester(actor: Actor, scope: TenantScope, id: string) {
    const doc = await this.loadScoped<SemesterDoc>('semester', scope, id, 'Semester');
    return this.setArchived(actor, 'semester', doc);
  }

  /* ───────────────────────── curriculum versions ───────────────────────── */

  async listCurriculumVersions(
    scope: TenantScope,
    institutionId: string,
    q: PageQuery,
  ): Promise<Paged<CurriculumVersionDoc>> {
    await this.assertActiveInstitution(scope, institutionId);
    return this.page(
      this.curricula as never,
      { institutionId: oid(institutionId) },
      q,
      { effectiveFromSession: -1 },
      ['label'],
    );
  }

  async createCurriculumVersion(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    input: Out<typeof CreateCurriculumVersionSchema>,
  ) {
    await this.assertActiveInstitution(scope, institutionId);
    let programmeId: Types.ObjectId | null = null;
    if (input.programmeId) {
      programmeId = (
        await this.loadParent<ProgrammeDoc>(
          'programme',
          institutionId,
          input.programmeId,
          'Programme',
          'programmeId',
        )
      )._id;
    }
    const created = await this.insert<CurriculumVersionDoc>(
      actor,
      'curriculumVersion',
      {
        institutionId: oid(institutionId),
        programmeId,
        label: input.label,
        effectiveFromSession: input.effectiveFromSession,
        isCurrent: input.isCurrent,
        notes: input.notes ?? null,
      },
      'A curriculum version with this label already exists',
    );
    if (created.isCurrent) await this.clearOtherCurrent(created);
    return created;
  }

  async updateCurriculumVersion(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: Out<typeof UpdateCurriculumVersionSchema>,
  ) {
    const before = await this.loadScoped<CurriculumVersionDoc>(
      'curriculumVersion',
      scope,
      id,
      'Curriculum version',
    );
    const after = await this.patch(
      actor,
      'curriculumVersion',
      before,
      input,
      'A curriculum version with this label already exists',
    );
    if (after.isCurrent && !before.isCurrent) await this.clearOtherCurrent(after);
    return after;
  }

  /** Only one current curriculum per (institution, programme). */
  private async clearOtherCurrent(doc: CurriculumVersionDoc) {
    await this.curricula.updateMany(
      {
        institutionId: doc.institutionId,
        programmeId: doc.programmeId,
        _id: { $ne: doc._id },
        isCurrent: true,
      },
      { $set: { isCurrent: false } },
    );
  }

  /* ───────────────────────── tree ───────────────────────── */

  async getTree(scope: TenantScope, institutionId: string): Promise<AcademicTree> {
    await this.assertActiveInstitution(scope, institutionId);
    const inst = oid(institutionId);
    const active = { institutionId: inst, archivedAt: null };
    const [institution, faculties, departments, programmes, levels, semesters] = await Promise.all([
      this.institutions.findById(inst).lean<InstitutionDoc>(),
      this.faculties.find(active).sort({ orderKey: 1 }).lean<FacultyDoc[]>(),
      this.departments.find(active).sort({ orderKey: 1 }).lean<DepartmentDoc[]>(),
      this.programmes.find(active).sort({ name: 1 }).lean<ProgrammeDoc[]>(),
      this.levels.find(active).sort({ rank: 1 }).lean<AcademicLevelDoc[]>(),
      this.semesters.find(active).sort({ rank: 1 }).lean<SemesterDoc[]>(),
    ]);
    const group = <T, K>(items: T[], key: (t: T) => K) => {
      const m = new Map<string, T[]>();
      for (const i of items) {
        const k = String(key(i));
        m.set(k, [...(m.get(k) ?? []), i]);
      }
      return m;
    };
    const deptByFaculty = group(departments, (d) => d.facultyId);
    const progByDept = group(programmes, (p) => p.departmentId);
    const levelsByProg = group(levels, (l) => l.programmeId);
    return {
      institution: {
        id: String(institution!._id),
        name: institution!.name,
        shortName: institution!.shortName,
      },
      semesters: semesters.map((s) => ({ id: String(s._id), name: s.name, code: s.code })),
      faculties: faculties.map((f) => ({
        id: String(f._id),
        name: f.name,
        departments: (deptByFaculty.get(String(f._id)) ?? []).map((d) => ({
          id: String(d._id),
          name: d.name,
          code: d.code,
          programmes: (progByDept.get(String(d._id)) ?? []).map((p) => ({
            id: String(p._id),
            name: p.name,
            award: p.award,
            code: p.code,
            levels: (levelsByProg.get(String(p._id)) ?? []).map((l) => ({
              id: String(l._id),
              name: l.name,
              code: l.code,
            })),
          })),
        })),
      })),
    };
  }
}
