import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type {
  ComposeQuizSchema,
  GenerateQuestionsSchema,
  Question,
  QuestionListQuerySchema,
  QuestionReviewSchema,
  UpdateQuestionSchema,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import { JobsService } from '../jobs/jobs.service.js';
import { UsageService } from '../ai/usage.service.js';
import type { TopicDoc } from '../courses/course.schemas.js';
import type { ContentVersionDoc, LearningMaterialDoc } from '../content/content.schemas.js';
import { ContentService } from '../content/content.service.js';
import type { QuestionDoc } from './question.schema.js';
import { stemHash, validateQuestion } from './question-rules.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class QuestionsService {
  constructor(
    @InjectModel(MODELS.Question) private readonly questions: Model<QuestionDoc>,
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    private readonly jobs: JobsService,
    private readonly usage: UsageService,
    private readonly content: ContentService,
    private readonly audit: AuditLogService,
  ) {}

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const q = await this.questions
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return q ? String(q.institutionId) : null;
  }

  private async load(scope: TenantScope, id: string): Promise<QuestionDoc> {
    const inst = await this.resolveInstitutionId(id);
    if (!inst) throw AppError.notFound('Question');
    assertInstitutionAccess(scope, inst);
    return (await this.questions
      .findOne({ _id: oid(id), institutionId: oid(inst) })
      .lean<QuestionDoc>())!;
  }

  /** Generate questions from an **approved** lesson version (docs/06 §8). */
  async startGeneration(
    actor: Actor,
    scope: TenantScope,
    lessonVersionId: string,
    input: z.output<typeof GenerateQuestionsSchema>,
  ) {
    const inst = await this.content.resolveVersionInstitution(lessonVersionId);
    if (!inst) throw AppError.notFound('Version');
    assertInstitutionAccess(scope, inst);
    const v = await this.versions
      .findOne({ _id: oid(lessonVersionId), institutionId: oid(inst) })
      .lean<ContentVersionDoc>();
    if (!v || !['notes_comprehensive', 'notes_simplified'].includes(v.kind))
      throw new AppError('VALIDATION_FAILED', 'Questions are generated from notes', [
        { path: 'versionId', issue: 'not_notes' },
      ]);
    if (v.reviewStatus !== 'approved')
      throw new AppError(
        'CONTENT_NOT_APPROVED',
        'Generate questions only from approved notes, so they match reviewed content',
      );
    await this.usage.assertWithinBudget(v.institutionId);
    const { job, deduplicated } = await this.jobs.start({
      type: 'quiz_generation',
      institutionId: v.institutionId,
      dedupeKey: `quiz:${v._id}:${input.types.join(',')}:${input.count}:${input.difficulty}`,
      target: { courseId: v.courseId },
      input: { lessonVersionId: String(v._id), ...input },
      requestedBy: actor.userId,
    });
    await this.audit.record({
      actor,
      action: 'quiz.generate',
      target: { type: 'content_version', id: v._id },
      institutionId: v.institutionId,
      after: input,
    });
    return { jobId: String(job._id), deduplicated };
  }

  async list(scope: TenantScope, q: z.output<typeof QuestionListQuerySchema>) {
    const f: Record<string, unknown> = {
      ...institutionFilter(scope, q.institutionId),
      isLatest: true,
    };
    if (q.courseId) f.courseId = oid(q.courseId);
    if (q.topicId) f.topicId = oid(q.topicId);
    if (q.status) f.reviewStatus = q.status;
    if (q.type) f.type = q.type;
    if (q.difficulty) f.difficulty = q.difficulty;
    if (q.q) f.stem = new RegExp(escapeRegex(q.q), 'i');
    const [items, total] = await Promise.all([
      this.questions
        .find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<QuestionDoc[]>(),
      this.questions.countDocuments(f),
    ]);
    return { items, total };
  }

  async get(scope: TenantScope, id: string) {
    return this.load(scope, id);
  }

  /** Drafts are edited in place; editing an approved/rejected question creates a new draft revision. */
  async update(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof UpdateQuestionSchema>,
  ): Promise<QuestionDoc> {
    const q = await this.load(scope, id);
    if (!q.isLatest) throw AppError.conflict('Edit the latest revision of this question');
    const draft = {
      type: q.type,
      stem: input.stem,
      options: q.type === 'mcq_single' || q.type === 'true_false' ? input.options : [],
      acceptedAnswers: input.acceptedAnswers,
    };
    const problems = validateQuestion(draft);
    if (problems.length)
      throw new AppError(
        'VALIDATION_FAILED',
        problems[0]!,
        problems.map((p) => ({ path: 'question', issue: p })),
      );
    const fields = {
      ...draft,
      explanation: input.explanation,
      difficulty: input.difficulty,
      stemHash: stemHash(input.stem),
      updatedBy: actor.userId ? oid(actor.userId) : null,
    };
    if (q.reviewStatus === 'draft') {
      await this.questions.updateOne(
        { _id: q._id, institutionId: q.institutionId },
        { $set: fields },
      );
      return (await this.questions
        .findOne({ _id: q._id, institutionId: q.institutionId })
        .lean<QuestionDoc>())!;
    }
    await this.questions.updateOne(
      { _id: q._id, institutionId: q.institutionId },
      { $set: { isLatest: false } },
    );
    const { _id, createdAt, updatedAt, ...rest } = q;
    void _id;
    void createdAt;
    void updatedAt;
    const created = await this.questions.create({
      ...rest,
      ...fields,
      revision: q.revision + 1,
      isLatest: true,
      reviewStatus: 'draft',
      reviewedBy: null,
      reviewComment: null,
      origin: 'manual',
      createdBy: actor.userId ? oid(actor.userId) : null,
    });
    await this.audit.record({
      actor,
      action: 'question.revise',
      target: { type: 'question', id: created._id },
      institutionId: q.institutionId,
      after: { revision: q.revision + 1 },
    });
    return created.toObject() as QuestionDoc;
  }

  /** Separation of duties: the author or last editor cannot approve (docs/03 §5). */
  async review(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof QuestionReviewSchema>,
  ): Promise<QuestionDoc> {
    const q = await this.load(scope, id);
    if (!q.isLatest || q.reviewStatus !== 'draft')
      throw new AppError('INVALID_TRANSITION', 'Only the latest draft revision can be reviewed');
    if (actor.userId && [String(q.createdBy), String(q.updatedBy)].includes(actor.userId)) {
      throw new AppError(
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot review a question you created or edited',
      );
    }
    await this.questions.updateOne(
      { _id: q._id, institutionId: q.institutionId, reviewStatus: 'draft' },
      {
        $set: {
          reviewStatus: input.decision,
          reviewedBy: oid(actor.userId!),
          reviewComment: input.comment || null,
        },
      },
    );
    await this.audit.record({
      actor,
      action: `question.${input.decision}`,
      target: { type: 'question', id },
      institutionId: q.institutionId,
    });
    return (await this.questions
      .findOne({ _id: q._id, institutionId: q.institutionId })
      .lean<QuestionDoc>())!;
  }

  /** A quiz version pins exact approved question revisions, so later edits never change it. */
  async composeQuiz(
    actor: Actor,
    scope: TenantScope,
    topicId: string,
    input: z.output<typeof ComposeQuizSchema>,
  ) {
    const topic = await this.topics
      .findOne({ _id: oid(topicId) })
      .setOptions({ crossTenant: true })
      .lean<TopicDoc>();
    if (!topic) throw AppError.notFound('Topic');
    assertInstitutionAccess(scope, topic.institutionId);
    const picked = await this.questions
      .find({
        institutionId: topic.institutionId,
        courseId: topic.courseId,
        _id: { $in: input.questionIds.map(oid) },
      })
      .lean<QuestionDoc[]>();
    const byId = new Map(picked.map((q) => [String(q._id), q]));
    const notApproved = input.questionIds.filter((id) => byId.get(id)?.reviewStatus !== 'approved');
    if (notApproved.length)
      throw new AppError(
        'CONTENT_NOT_APPROVED',
        'Quizzes can only contain approved questions',
        notApproved.map((id) => ({ path: 'questionIds', issue: id })),
      );
    const material = await this.materials
      .findOneAndUpdate(
        { institutionId: topic.institutionId, topicId: topic._id, kind: 'quiz', locale: 'en-NG' },
        { $setOnInsert: { courseId: topic.courseId, title: `${topic.title}: Quiz` } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<LearningMaterialDoc>();
    const body = {
      kind: 'quiz',
      questionRefs: input.questionIds.map((id) => ({
        questionId: id,
        lineageId: String(byId.get(id)!.lineageId),
        revision: byId.get(id)!.revision,
      })),
      settings: input.settings,
    };
    const version = await this.content.createManualVersion(actor, material!, body);
    await this.audit.record({
      actor,
      action: 'quiz.compose',
      target: { type: 'content_version', id: version._id },
      institutionId: topic.institutionId,
      after: { questions: input.questionIds.length },
    });
    return this.content.getVersion(scope, String(version._id));
  }

  async quizQuestions(scope: TenantScope, versionId: string): Promise<QuestionDoc[]> {
    const v = await this.content.getVersion(scope, versionId);
    if (v.body?.kind !== 'quiz') return [];
    const ids = v.body.questionRefs.map((r) => oid(r.questionId));
    const qs = await this.questions
      .find({ institutionId: oid(v.context.institutionId), _id: { $in: ids } })
      .lean<QuestionDoc[]>();
    const order = new Map(ids.map((id, i) => [String(id), i]));
    return qs.sort((a, b) => order.get(String(a._id))! - order.get(String(b._id))!);
  }

  async toDtos(items: QuestionDoc[]): Promise<Question[]> {
    if (!items.length) return [];
    const topics = await this.topics
      .find(
        {
          institutionId: { $in: [...new Set(items.map((q) => String(q.institutionId)))].map(oid) },
          _id: { $in: items.map((q) => q.topicId) },
        },
        { title: 1 },
      )
      .lean<TopicDoc[]>();
    const t = new Map(topics.map((x) => [String(x._id), x.title]));
    return items.map((q) => ({
      id: String(q._id),
      lineageId: String(q.lineageId),
      revision: q.revision,
      courseId: String(q.courseId),
      topicId: String(q.topicId),
      type: q.type,
      stem: q.stem,
      options: q.options,
      acceptedAnswers: q.acceptedAnswers,
      explanation: q.explanation,
      difficulty: q.difficulty,
      sourceLessonVersionId: q.sourceLessonVersionId ? String(q.sourceLessonVersionId) : null,
      origin: q.origin,
      provider: q.generation?.provider ?? null,
      reviewStatus: q.reviewStatus,
      reviewComment: q.reviewComment ?? null,
      duplicateOf: q.duplicateOf ? String(q.duplicateOf) : null,
      isLatest: q.isLatest,
      createdBy: q.createdBy ? String(q.createdBy) : null,
      topicTitle: t.get(String(q.topicId)) ?? '',
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    }));
  }
}
