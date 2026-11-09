import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type {
  DashboardOverview,
  Engagement,
  StudentAccount,
  StudentListQuerySchema,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import type { AuditLogDoc } from '../audit/audit-log.schema.js';
import type {
  AcademicLevelDoc,
  DepartmentDoc,
  InstitutionDoc,
  ProgrammeDoc,
} from '../academic/academic.schemas.js';
import type { CourseDoc, TopicDoc } from '../courses/course.schemas.js';
import type { ContentVersionDoc, LearningMaterialDoc } from '../content/content.schemas.js';
import type { QuestionDoc } from '../quizzes/question.schema.js';
import type { AiUsageDoc, GenerationJobDoc } from '../sources/source.schemas.js';
import type { AuthSessionDoc, UserDoc } from '../identity/identity.schemas.js';
import type { EnrolmentDoc, MaterialProgressDoc, QuizAttemptDoc } from './learning.schemas.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const DAY = 24 * 3600 * 1000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Read-only operational metrics and student administration for the admin portal (docs/04 §3.11). */
@Injectable()
export class InsightsService {
  constructor(
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    @InjectModel(MODELS.Department) private readonly departments: Model<DepartmentDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.Question) private readonly questions: Model<QuestionDoc>,
    @InjectModel(MODELS.GenerationJob) private readonly jobs: Model<GenerationJobDoc>,
    @InjectModel(MODELS.AiUsage) private readonly usage: Model<AiUsageDoc>,
    @InjectModel(MODELS.AuditLog) private readonly auditLogs: Model<AuditLogDoc>,
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    @InjectModel(MODELS.AuthSession) private readonly sessions: Model<AuthSessionDoc>,
    @InjectModel(MODELS.Enrolment) private readonly enrolments: Model<EnrolmentDoc>,
    @InjectModel(MODELS.MaterialProgress) private readonly progress: Model<MaterialProgressDoc>,
    @InjectModel(MODELS.QuizAttempt) private readonly attempts: Model<QuizAttemptDoc>,
    private readonly audit: AuditLogService,
  ) {}

  /** Institution ids in scope, as ObjectIds (null = every institution). */
  private ids(scope: TenantScope, requested?: string): Types.ObjectId[] | null {
    if (requested) {
      assertInstitutionAccess(scope, requested);
      return [oid(requested)];
    }
    return scope.kind === 'all' ? null : scope.institutionIds.map(oid);
  }

  /* ───────────── dashboard ───────────── */

  async overview(scope: TenantScope): Promise<DashboardOverview> {
    const f = institutionFilter(scope);
    const ids = this.ids(scope);
    const studentFilter: Record<string, unknown> = {
      accountType: 'student',
      ...(ids ? { 'studentProfile.institutionId': { $in: ids } } : {}),
    };
    const since30 = new Date(Date.now() - 30 * DAY);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      institutions,
      departments,
      programmes,
      courses,
      publishedCourses,
      topics,
      publishedLessons,
      draftLessons,
      awaitingReview,
      questionsAwaitingReview,
      failedJobs30d,
      registeredStudents,
      active,
      ai,
      recent,
    ] = await Promise.all([
      this.institutions.countDocuments({ archivedAt: null, ...(ids ? { _id: { $in: ids } } : {}) }),
      this.departments.countDocuments({ ...f, archivedAt: null }),
      this.programmes.countDocuments({ ...f, archivedAt: null }),
      this.courses.countDocuments({ ...f, archivedAt: null }),
      this.courses.countDocuments({ ...f, archivedAt: null, 'publication.state': 'published' }),
      this.topics.countDocuments({ ...f, archivedAt: null }),
      this.materials.countDocuments({ ...f, 'publication.state': 'published' }),
      this.materials.countDocuments({
        ...f,
        'publication.state': { $ne: 'published' },
        currentDraftVersionId: { $ne: null },
      }),
      this.versions.countDocuments({ ...f, reviewStatus: 'in_review' }),
      this.questions.countDocuments({ ...f, isLatest: true, reviewStatus: 'draft' }),
      this.jobs.countDocuments({ ...f, status: 'failed', updatedAt: { $gte: since30 } }),
      this.users.countDocuments(studentFilter),
      this.progress.aggregate<{ n: number }>([
        { $match: { ...f, updatedAt: { $gte: since30 } } },
        { $group: { _id: '$userId' } },
        { $count: 'n' },
      ]),
      this.usage.aggregate<{ calls: number; tokens: number }>([
        { $match: { ...f, at: { $gte: monthStart } } },
        {
          $group: {
            _id: null,
            calls: { $sum: 1 },
            tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
          },
        },
      ]),
      this.auditLogs
        .find(ids ? { institutionId: { $in: ids } } : {})
        .sort({ at: -1 })
        .limit(8)
        .lean<AuditLogDoc[]>(),
    ]);

    const actorIds = [
      ...new Set(
        recent
          .map((r) => r.actorId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const actors = await this.users
      .find({ _id: { $in: actorIds.map(oid) } }, { profile: 1, email: 1 })
      .lean<UserDoc[]>();
    const names = new Map(
      actors.map((u) => [
        String(u._id),
        `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.email,
      ]),
    );
    return {
      counts: {
        institutions,
        departments,
        programmes,
        courses,
        publishedCourses,
        topics,
        publishedLessons,
        draftLessons,
        awaitingReview,
        questionsAwaitingReview,
        failedJobs30d,
        registeredStudents,
        activeStudents30d: active[0]?.n ?? 0,
        aiCallsThisMonth: ai[0]?.calls ?? 0,
        aiTokensThisMonth: ai[0]?.tokens ?? 0,
      },
      recentActivity: recent.map((r) => ({
        action: r.action,
        actorName: r.actorId ? (names.get(String(r.actorId)) ?? 'Unknown user') : 'System',
        target: r.target.type,
        at: r.at.toISOString(),
      })),
    };
  }

  /* ───────────── engagement ───────────── */

  async engagement(
    scope: TenantScope,
    q: { institutionId?: string; courseId?: string },
  ): Promise<Engagement> {
    const f: Record<string, unknown> = { ...institutionFilter(scope, q.institutionId) };
    if (q.courseId) f.courseId = oid(q.courseId);
    const since30 = new Date(Date.now() - 30 * DAY);

    const [
      enrolments,
      active,
      completions,
      quizAgg,
      perCourseEnrol,
      perCourseProgress,
      perCourseQuiz,
      perMaterial,
      perMaterialQuiz,
    ] = await Promise.all([
      this.enrolments.countDocuments(f),
      this.progress.aggregate<{ n: number }>([
        { $match: { ...f, updatedAt: { $gte: since30 } } },
        { $group: { _id: '$userId' } },
        { $count: 'n' },
      ]),
      this.progress.countDocuments({ ...f, state: 'completed' }),
      this.attempts.aggregate<{ n: number; avg: number }>([
        { $match: f },
        { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$percent' } } },
      ]),
      this.enrolments.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: f },
        { $group: { _id: '$courseId', n: { $sum: 1 } } },
      ]),
      this.progress.aggregate<{ _id: Types.ObjectId; done: number; total: number }>([
        { $match: f },
        {
          $group: {
            _id: '$courseId',
            done: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
      ]),
      this.attempts.aggregate<{ _id: Types.ObjectId; n: number; avg: number }>([
        { $match: f },
        { $group: { _id: '$courseId', n: { $sum: 1 }, avg: { $avg: '$percent' } } },
      ]),
      this.progress.aggregate<{ _id: Types.ObjectId; started: number; completed: number }>([
        { $match: f },
        {
          $group: {
            _id: '$materialId',
            started: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
          },
        },
        { $sort: { started: -1 } },
        { $limit: 20 },
      ]),
      this.attempts.aggregate<{ _id: Types.ObjectId; avg: number }>([
        { $match: f },
        { $group: { _id: '$materialId', avg: { $avg: '$percent' } } },
      ]),
    ]);

    const courseIds = [
      ...new Set(
        [...perCourseEnrol, ...perCourseProgress, ...perCourseQuiz].map((c) => String(c._id)),
      ),
    ];
    const instF = institutionFilter(scope, q.institutionId);
    const courseDocs = courseIds.length
      ? await this.courses
          .find({ ...instF, _id: { $in: courseIds.map(oid) } }, { code: 1, title: 1 })
          .lean<CourseDoc[]>()
      : [];
    const enrolBy = new Map(perCourseEnrol.map((c) => [String(c._id), c.n]));
    const progBy = new Map(perCourseProgress.map((c) => [String(c._id), c]));
    const quizBy = new Map(perCourseQuiz.map((c) => [String(c._id), c]));
    const matDocs = perMaterial.length
      ? await this.materials
          .find({ ...instF, _id: { $in: perMaterial.map((m) => m._id) } }, { title: 1, kind: 1 })
          .lean<LearningMaterialDoc[]>()
      : [];
    const matBy = new Map(matDocs.map((m) => [String(m._id), m]));
    const matQuiz = new Map(perMaterialQuiz.map((m) => [String(m._id), m.avg]));
    const round = (n: number | undefined | null) => (n == null ? null : Math.round(n * 10) / 10);

    return {
      enrolments,
      activeLearners30d: active[0]?.n ?? 0,
      completions,
      quizAttempts: quizAgg[0]?.n ?? 0,
      averageQuizPercent: round(quizAgg[0]?.avg),
      courses: courseDocs
        .map((c) => {
          const p = progBy.get(String(c._id));
          const qz = quizBy.get(String(c._id));
          return {
            courseId: String(c._id),
            code: c.code,
            title: c.title,
            enrolments: enrolBy.get(String(c._id)) ?? 0,
            completionPercent: p && p.total ? Math.round((p.done / p.total) * 100) : 0,
            quizAttempts: qz?.n ?? 0,
            averageQuizPercent: round(qz?.avg),
          };
        })
        .sort((a, b) => b.enrolments - a.enrolments),
      materials: perMaterial
        .filter((m) => matBy.has(String(m._id)))
        .map((m) => {
          const doc = matBy.get(String(m._id))!;
          return {
            materialId: String(m._id),
            label: doc.title,
            started: m.started,
            completed: m.completed,
            averageQuizPercent: round(matQuiz.get(String(m._id))),
          };
        }),
    };
  }

  /* ───────────── students ───────────── */

  async listStudents(scope: TenantScope, q: z.output<typeof StudentListQuerySchema>) {
    const ids = this.ids(scope, q.institutionId);
    const f: Record<string, unknown> = {
      accountType: 'student',
      ...(ids ? { 'studentProfile.institutionId': { $in: ids } } : {}),
    };
    if (q.status) f.status = q.status;
    if (q.q) {
      const r = new RegExp(escapeRegex(q.q), 'i');
      f.$or = [{ email: r }, { 'profile.firstName': r }, { 'profile.lastName': r }];
    }
    const [items, total] = await Promise.all([
      this.users
        .find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<UserDoc[]>(),
      this.users.countDocuments(f),
    ]);
    return { total, items: await this.toStudents(items) };
  }

  private async toStudents(items: UserDoc[]): Promise<StudentAccount[]> {
    const progIds = items
      .map((u) => u.studentProfile?.programmeId)
      .filter((x): x is Types.ObjectId => !!x);
    const levelIds = items
      .map((u) => u.studentProfile?.levelId)
      .filter((x): x is Types.ObjectId => !!x);
    const instIds = [
      ...new Set(items.map((u) => String(u.studentProfile?.institutionId ?? '')).filter(Boolean)),
    ].map(oid);
    const inst = { institutionId: { $in: instIds } };
    const [progs, lvls, enrol] = await Promise.all([
      progIds.length
        ? this.programmes
            .find({ ...inst, _id: { $in: progIds } }, { name: 1 })
            .lean<ProgrammeDoc[]>()
        : [],
      levelIds.length
        ? this.levels
            .find({ ...inst, _id: { $in: levelIds } }, { name: 1 })
            .lean<AcademicLevelDoc[]>()
        : [],
      instIds.length
        ? this.enrolments.aggregate<{ _id: Types.ObjectId; n: number }>([
            { $match: { ...inst, userId: { $in: items.map((u) => u._id) } } },
            { $group: { _id: '$userId', n: { $sum: 1 } } },
          ])
        : [],
    ]);
    const pn = new Map(progs.map((p) => [String(p._id), p.name]));
    const ln = new Map(lvls.map((l) => [String(l._id), l.name]));
    const en = new Map(enrol.map((e) => [String(e._id), e.n]));
    return items.map((u) => ({
      id: String(u._id),
      email: u.email,
      firstName: u.profile.firstName,
      lastName: u.profile.lastName,
      status: u.status,
      emailVerified: !!u.emailVerifiedAt,
      programme: u.studentProfile?.programmeId
        ? (pn.get(String(u.studentProfile.programmeId)) ?? null)
        : null,
      level: u.studentProfile?.levelId ? (ln.get(String(u.studentProfile.levelId)) ?? null) : null,
      enrolments: en.get(String(u._id)) ?? 0,
      lastLoginAt: u.security.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /** Institution of a student account (scope resolver for /admin/students/:id). */
  async resolveStudentInstitution(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const u = await this.users
      .findOne({ _id: oid(id), accountType: 'student' }, { studentProfile: 1 })
      .lean<UserDoc>();
    return u?.studentProfile ? String(u.studentProfile.institutionId) : null;
  }

  async setStudentStatus(
    scope: TenantScope,
    actor: Actor,
    id: string,
    status: 'active' | 'suspended',
    reason?: string,
  ): Promise<StudentAccount> {
    const u = await this.users.findOne({ _id: oid(id), accountType: 'student' }).lean<UserDoc>();
    if (!u?.studentProfile) throw AppError.notFound('Student');
    assertInstitutionAccess(scope, u.studentProfile.institutionId);
    if (u.status !== 'active' && u.status !== 'suspended')
      throw AppError.conflict('Only active or suspended accounts can be changed');
    if (u.status !== status) {
      await this.users.updateOne({ _id: u._id }, { $set: { status } });
      if (status === 'suspended')
        await this.sessions.updateMany(
          { userId: u._id, revokedAt: null },
          { $set: { revokedAt: new Date(), revokeReason: 'account_suspended' } },
        );
      await this.audit.record({
        actor,
        action: status === 'suspended' ? 'student.suspend' : 'student.reactivate',
        target: { type: 'user', id: u._id },
        institutionId: u.studentProfile.institutionId,
        before: { status: u.status },
        after: { status, reason: reason ?? null },
      });
    }
    const fresh = await this.users.findById(u._id).lean<UserDoc>();
    return (await this.toStudents([fresh!]))[0]!;
  }
}
