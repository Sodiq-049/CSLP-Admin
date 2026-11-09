import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type { StudentCourseQuerySchema, StudentMaterial } from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { assertInstitutionAccess, type TenantScope } from '../tenancy/tenant-scope.js';
import type {
  AcademicLevelDoc,
  InstitutionDoc,
  ProgrammeDoc,
  SemesterDoc,
} from '../academic/academic.schemas.js';
import type { CourseDoc, TopicDoc } from '../courses/course.schemas.js';
import type { ContentVersionDoc, LearningMaterialDoc } from '../content/content.schemas.js';
import type { QuestionDoc } from '../quizzes/question.schema.js';
import type { UserDoc } from '../identity/identity.schemas.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_FOUND = () => AppError.notFound(); // hidden content is indistinguishable from missing content

/**
 * The single student read path (docs/05 §7). Every query goes through `visible*` filters, versions
 * are loaded only via `publishedVersionId`, and output uses explicit allow-list serialisers.
 */
@Injectable()
export class PublishedContentService {
  constructor(
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.Question) private readonly questions: Model<QuestionDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    @InjectModel(MODELS.Semester) private readonly semesters: Model<SemesterDoc>,
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
  ) {}

  /** A student's institution comes from their own profile, never from the request. */
  async studentInstitution(userId: string): Promise<Types.ObjectId> {
    const u = await this.users
      .findById(userId, { accountType: 1, studentProfile: 1 })
      .lean<UserDoc>();
    if (!u || u.accountType !== 'student' || !u.studentProfile?.institutionId)
      throw AppError.forbidden('Student profile required');
    const active = await this.institutions.exists({
      _id: u.studentProfile.institutionId,
      status: 'active',
      archivedAt: null,
    });
    if (!active) throw NOT_FOUND();
    return u.studentProfile.institutionId;
  }

  private visibleCourse = (institutionId: Types.ObjectId) => ({
    institutionId,
    'publication.state': 'published' as const,
    archivedAt: null,
  });
  private visibleTopic = (institutionId: Types.ObjectId, courseId: Types.ObjectId) => ({
    institutionId,
    courseId,
    'publication.state': 'published' as const,
    archivedAt: null,
  });
  private visibleMaterial = (institutionId: Types.ObjectId) => ({
    institutionId,
    'publication.state': 'published' as const,
    publishedVersionId: { $ne: null },
  });

  private async labels(courses: CourseDoc[]) {
    const inst = {
      institutionId: { $in: [...new Set(courses.map((c) => String(c.institutionId)))].map(oid) },
    };
    const [p, l, s] = await Promise.all([
      this.programmes
        .find({ ...inst, _id: { $in: courses.map((c) => c.programmeId) } }, { name: 1 })
        .lean<ProgrammeDoc[]>(),
      this.levels
        .find({ ...inst, _id: { $in: courses.map((c) => c.levelId) } }, { name: 1 })
        .lean<AcademicLevelDoc[]>(),
      this.semesters
        .find({ ...inst, _id: { $in: courses.map((c) => c.semesterId) } }, { name: 1 })
        .lean<SemesterDoc[]>(),
    ]);
    const m = (xs: { _id: Types.ObjectId; name: string }[]) =>
      new Map(xs.map((x) => [String(x._id), x.name]));
    return { p: m(p), l: m(l), s: m(s) };
  }

  async listCourses(institutionId: Types.ObjectId, q: z.output<typeof StudentCourseQuerySchema>) {
    const f: Record<string, unknown> = this.visibleCourse(institutionId);
    for (const k of ['programmeId', 'levelId', 'semesterId'] as const) if (q[k]) f[k] = oid(q[k]!);
    if (q.q)
      f.$or = [
        { title: new RegExp(escapeRegex(q.q), 'i') },
        { code: new RegExp(escapeRegex(q.q), 'i') },
      ];
    const [items, total] = await Promise.all([
      this.courses
        .find(f)
        .sort({ codeNormalized: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<CourseDoc[]>(),
      this.courses.countDocuments(f),
    ]);
    const lb = await this.labels(items);
    const counts = await this.topics.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          institutionId,
          courseId: { $in: items.map((c) => c._id) },
          parentTopicId: null,
          'publication.state': 'published',
          archivedAt: null,
        },
      },
      { $group: { _id: '$courseId', n: { $sum: 1 } } },
    ]);
    const cn = new Map(counts.map((c) => [String(c._id), c.n]));
    return {
      total,
      items: items.map((c) => this.courseSummary(c, lb, cn.get(String(c._id)) ?? 0)),
    };
  }

  private courseSummary(
    c: CourseDoc,
    lb: Awaited<ReturnType<PublishedContentService['labels']>>,
    topicCount: number,
  ) {
    return {
      id: String(c._id),
      code: c.code,
      title: c.title,
      creditUnits: c.creditUnits,
      description: c.description,
      programme: lb.p.get(String(c.programmeId)) ?? '',
      level: lb.l.get(String(c.levelId)) ?? '',
      semester: lb.s.get(String(c.semesterId)) ?? '',
      topicCount,
    };
  }

  async courseDetail(institutionId: Types.ObjectId, courseId: string) {
    if (!Types.ObjectId.isValid(courseId)) throw NOT_FOUND();
    const c = await this.courses
      .findOne({ ...this.visibleCourse(institutionId), _id: oid(courseId) })
      .lean<CourseDoc>();
    if (!c) throw NOT_FOUND();
    const topics = await this.topics
      .find(this.visibleTopic(institutionId, c._id))
      .sort({ orderKey: 1 })
      .lean<TopicDoc[]>();
    const tops = topics.filter((t) => !t.parentTopicId);
    const topIds = new Set(tops.map((t) => String(t._id)));
    const subs = topics.filter((t) => t.parentTopicId && topIds.has(String(t.parentTopicId))); // parent must be visible too
    const mats = await this.materials
      .find({
        ...this.visibleMaterial(institutionId),
        topicId: { $in: [...tops, ...subs].map((t) => t._id) },
      })
      .sort({ kind: 1 })
      .lean<LearningMaterialDoc[]>();
    const matsOf = (id: Types.ObjectId) =>
      mats
        .filter((m) => String(m.topicId) === String(id))
        .map((m) => ({
          id: String(m._id),
          kind: m.kind,
          title: m.title,
          publishedAt: m.publication.publishedAt?.toISOString() ?? null,
        }));
    const lb = await this.labels([c]);
    return {
      ...this.courseSummary(c, lb, tops.length),
      objectives: c.objectives.map((o) => o.text),
      topics: tops.map((t) => ({
        id: String(t._id),
        title: t.title,
        slug: t.slug,
        materials: matsOf(t._id),
        subtopics: subs
          .filter((s) => String(s.parentTopicId) === String(t._id))
          .map((s) => ({
            id: String(s._id),
            title: s.title,
            slug: s.slug,
            materials: matsOf(s._id),
          })),
      })),
    };
  }

  async material(institutionId: Types.ObjectId, materialId: string): Promise<StudentMaterial> {
    if (!Types.ObjectId.isValid(materialId)) throw NOT_FOUND();
    const m = await this.materials
      .findOne({ ...this.visibleMaterial(institutionId), _id: oid(materialId) })
      .lean<LearningMaterialDoc>();
    if (!m) throw NOT_FOUND();
    const topic = await this.topics
      .findOne({ ...this.visibleTopic(institutionId, m.courseId), _id: m.topicId })
      .lean<TopicDoc>();
    if (!topic) throw NOT_FOUND();
    if (
      topic.parentTopicId &&
      !(await this.topics.exists({
        ...this.visibleTopic(institutionId, m.courseId),
        _id: topic.parentTopicId,
      }))
    )
      throw NOT_FOUND();
    const course = await this.courses
      .findOne({ ...this.visibleCourse(institutionId), _id: m.courseId })
      .lean<CourseDoc>();
    if (!course) throw NOT_FOUND();
    // Only ever the published version, never a client-supplied version id.
    const v = await this.versions
      .findOne({ institutionId, _id: m.publishedVersionId })
      .lean<ContentVersionDoc>();
    if (!v) throw NOT_FOUND();
    return this.serialize(v, m, course, topic);
  }

  /** Admin preview: any version, rendered exactly as students would receive it. */
  async preview(scope: TenantScope, versionId: string): Promise<StudentMaterial> {
    if (!Types.ObjectId.isValid(versionId)) throw NOT_FOUND();
    const v = await this.versions
      .findOne({ _id: oid(versionId) })
      .setOptions({ crossTenant: true })
      .lean<ContentVersionDoc>();
    if (!v) throw NOT_FOUND();
    assertInstitutionAccess(scope, v.institutionId);
    const inst = { institutionId: v.institutionId };
    const [m, course, topic] = await Promise.all([
      this.materials.findOne({ ...inst, _id: v.materialId }).lean<LearningMaterialDoc>(),
      this.courses.findOne({ ...inst, _id: v.courseId }).lean<CourseDoc>(),
      this.topics.findOne({ ...inst, _id: v.topicId }).lean<TopicDoc>(),
    ]);
    if (!m || !course || !topic || !v.body) throw NOT_FOUND();
    return this.serialize(v, m, course, topic);
  }

  /** Explicit allow-list: no reviewer data, generation details, draft pointers or quiz answers. */
  private async serialize(
    v: ContentVersionDoc,
    m: LearningMaterialDoc,
    course: CourseDoc,
    topic: TopicDoc,
  ): Promise<StudentMaterial> {
    const body = v.body as Record<string, unknown>;
    let content: StudentMaterial['content'];
    if (body.kind === 'notes') {
      content = {
        kind: 'notes',
        doc: body.doc as { type: 'doc'; content: unknown[] },
        wordCount: Number(body.wordCount ?? 0),
        readingMinutes: Number(body.readingMinutes ?? 1),
      };
    } else if (body.kind === 'revision_pack') {
      const b = body as {
        summary: string;
        keyPoints: { text: string }[];
        flashcards: { front: string; back: string }[];
        faq: { question: string; answer: string }[];
        checklist: string[];
      };
      content = {
        kind: 'revision_pack',
        summary: b.summary,
        keyPoints: b.keyPoints.map((k) => k.text),
        flashcards: b.flashcards,
        faq: b.faq,
        checklist: b.checklist,
      };
    } else {
      const b = body as {
        questionRefs: { questionId: string }[];
        settings: { shuffle: boolean; timeLimitMinutes: number | null; passMarkPercent: number };
      };
      const ids = b.questionRefs.map((r) => oid(r.questionId));
      const qs = await this.questions
        .find(
          { institutionId: v.institutionId, _id: { $in: ids } },
          { type: 1, stem: 1, options: 1 },
        )
        .lean<QuestionDoc[]>();
      const order = new Map(ids.map((id, i) => [String(id), i]));
      content = {
        kind: 'quiz',
        settings: b.settings,
        questions: qs
          .sort((a, c) => order.get(String(a._id))! - order.get(String(c._id))!)
          .map((q) => ({
            id: String(q._id),
            type: q.type,
            stem: q.stem,
            options: q.options.map((o) => ({ id: o.id, text: o.text })),
          })),
      };
    }
    return {
      id: String(m._id),
      kind: m.kind,
      title: m.title,
      course: { id: String(course._id), code: course.code, title: course.title },
      topic: { id: String(topic._id), title: topic.title },
      publishedAt: m.publication.publishedAt?.toISOString() ?? null,
      content,
      citations: (v.provenance?.citations ?? []).map((c) => ({
        index: c.index,
        sourceTitle: c.sourceTitle,
        page: c.page ?? null,
      })),
      aiAssisted: v.origin !== 'manual' || !!v.generation,
    };
  }
}
