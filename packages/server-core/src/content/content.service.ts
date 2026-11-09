import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type { DisplayStatus, GeneratableKind, MaterialKind } from '@cslp/shared-types';
import type {
  ContentVersion,
  GenerateContentSchema,
  LearningMaterial,
  ReviewDecisionSchema,
  VersionBody,
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
import { CoursesService } from '../courses/courses.service.js';
import type { CourseDoc, TopicDoc } from '../courses/course.schemas.js';
import type { UserDoc } from '../identity/identity.schemas.js';
import type {
  ContentReviewDoc,
  ContentVersionDoc,
  LearningMaterialDoc,
} from './content.schemas.js';
import { docStats, MAX_DOC_BYTES, sanitizeDoc } from './rich-doc.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
export const KIND_LABEL: Record<MaterialKind, string> = {
  notes_comprehensive: 'Comprehensive notes',
  notes_simplified: 'Simplified notes',
  revision_pack: 'Revision pack',
  quiz: 'Quiz',
  video: 'Video',
  resource: 'Resource',
};
const bodyKindFor = (kind: MaterialKind) =>
  kind === 'revision_pack' ? 'revision_pack' : kind === 'quiz' ? 'quiz' : 'notes';

/** Learning materials and their versions (docs/05). Publishing lives in a later phase. */
@Injectable()
export class ContentService {
  constructor(
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.ContentReview) private readonly reviews: Model<ContentReviewDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.Course) private readonly courseModel: Model<CourseDoc>,
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    private readonly courses: CoursesService,
    private readonly jobs: JobsService,
    private readonly audit: AuditLogService,
    private readonly usage: UsageService,
  ) {}

  /* ───────────── scope resolution ───────────── */

  async resolveVersionInstitution(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const v = await this.versions
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return v ? String(v.institutionId) : null;
  }

  private async loadVersion(scope: TenantScope, id: string): Promise<ContentVersionDoc> {
    const inst = await this.resolveVersionInstitution(id);
    if (!inst) throw AppError.notFound('Version');
    assertInstitutionAccess(scope, inst);
    const v = await this.versions
      .findOne({ _id: oid(id), institutionId: oid(inst) })
      .lean<ContentVersionDoc>();
    if (!v) throw AppError.notFound('Version');
    return v;
  }

  /* ───────────── generation ───────────── */

  async startGeneration(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    input: z.output<typeof GenerateContentSchema>,
  ) {
    const course = await this.courses.load(scope, courseId);
    if (course.archivedAt) throw AppError.conflict('Archived courses cannot be edited');
    await this.usage.assertWithinBudget(course.institutionId);
    const topics = await this.topics
      .find({
        institutionId: course.institutionId,
        courseId: course._id,
        _id: { $in: input.topicIds.map(oid) },
        archivedAt: null,
      })
      .lean<TopicDoc[]>();
    if (topics.length !== new Set(input.topicIds).size)
      throw new AppError('VALIDATION_FAILED', 'Some topics are not part of this course', [
        { path: 'topicIds', issue: 'not_found' },
      ]);

    const jobs = [];
    for (const topic of topics) {
      for (const kind of input.kinds)
        jobs.push(await this.startOne(actor, course, topic, kind, input.options));
    }
    await this.audit.record({
      actor,
      action: 'content.generate',
      target: { type: 'course', id: course._id },
      institutionId: course.institutionId,
      after: { topics: topics.length, kinds: input.kinds },
    });
    return { jobs };
  }

  private async startOne(
    actor: Actor,
    course: CourseDoc,
    topic: TopicDoc,
    kind: GeneratableKind,
    options: object,
  ) {
    const material = await this.materials
      .findOneAndUpdate(
        { institutionId: course.institutionId, topicId: topic._id, kind, locale: 'en-NG' },
        { $setOnInsert: { courseId: course._id, title: `${topic.title}: ${KIND_LABEL[kind]}` } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<LearningMaterialDoc>();
    const active = await this.versions
      .findOne({
        institutionId: course.institutionId,
        materialId: material!._id,
        generationStatus: { $in: ['queued', 'generating'] },
      })
      .lean<ContentVersionDoc>();
    if (active?.generation?.jobId) {
      return {
        jobId: String(active.generation.jobId),
        topicId: String(topic._id),
        kind,
        materialId: String(material!._id),
        versionId: String(active._id),
        deduplicated: true,
      };
    }
    const version = await this.createVersion(material!, {
      origin: 'ai_generated',
      generationStatus: 'queued',
      createdBy: actor.userId ? oid(actor.userId) : null,
    });
    const { job } = await this.jobs.start({
      type: 'content_generation',
      institutionId: course.institutionId,
      dedupeKey: `gen:${version._id}`,
      target: { courseId: course._id },
      input: { versionId: String(version._id), options },
      requestedBy: actor.userId,
    });
    await this.versions.updateOne(
      { _id: version._id, institutionId: version.institutionId },
      {
        $set: {
          generation: {
            jobId: job._id,
            provider: '',
            model: '',
            taskKey: '',
            promptVersion: '',
            options,
            error: null,
          },
        },
      },
    );
    await this.materials.updateOne(
      { _id: material!._id, institutionId: material!.institutionId },
      { $set: { currentDraftVersionId: version._id } },
    );
    await this.refreshStatus(material!._id, material!.institutionId);
    return {
      jobId: String(job._id),
      topicId: String(topic._id),
      kind,
      materialId: String(material!._id),
      versionId: String(version._id),
      deduplicated: false,
    };
  }

  private async createVersion(
    material: LearningMaterialDoc,
    fields: Partial<ContentVersionDoc>,
  ): Promise<ContentVersionDoc> {
    for (let attempt = 0; ; attempt++) {
      const last = await this.versions
        .findOne(
          { institutionId: material.institutionId, materialId: material._id },
          { versionNumber: 1 },
        )
        .sort({ versionNumber: -1 })
        .lean<{ versionNumber: number }>();
      try {
        return (
          await this.versions.create({
            institutionId: material.institutionId,
            materialId: material._id,
            courseId: material.courseId,
            topicId: material.topicId,
            kind: material.kind,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            ...fields,
          })
        ).toObject() as ContentVersionDoc;
      } catch (err) {
        if ((err as { code?: number }).code === 11000 && attempt < 3) continue;
        throw err;
      }
    }
  }

  /** Manually created version (e.g. a composed quiz) as the material's new draft. */
  async createManualVersion(
    actor: Actor,
    material: LearningMaterialDoc,
    body: Record<string, unknown>,
  ): Promise<ContentVersionDoc> {
    if (material.currentDraftVersionId) {
      const draft = await this.versions
        .findOne(
          { _id: material.currentDraftVersionId, institutionId: material.institutionId },
          { reviewStatus: 1, versionNumber: 1 },
        )
        .lean<ContentVersionDoc>();
      if (draft?.reviewStatus === 'draft')
        throw new AppError('CONFLICT', `Version ${draft.versionNumber} is already an open draft`, [
          { path: 'versionId', issue: String(draft._id) },
        ]);
    }
    const v = await this.createVersion(material, {
      origin: 'manual',
      generationStatus: 'none',
      body,
      createdBy: actor.userId ? oid(actor.userId) : null,
      updatedBy: actor.userId ? oid(actor.userId) : null,
    });
    await this.materials.updateOne(
      { _id: material._id, institutionId: material.institutionId },
      { $set: { currentDraftVersionId: v._id } },
    );
    await this.refreshStatus(material._id, material.institutionId);
    return v;
  }

  /* ───────────── reading ───────────── */

  async listForTopic(scope: TenantScope, topicId: string): Promise<LearningMaterial[]> {
    const topic = await this.topics
      .findOne({ _id: oid(topicId) })
      .setOptions({ crossTenant: true })
      .lean<TopicDoc>();
    if (!topic) throw AppError.notFound('Topic');
    assertInstitutionAccess(scope, topic.institutionId);
    const mats = await this.materials
      .find({ institutionId: topic.institutionId, topicId: topic._id })
      .sort({ kind: 1 })
      .lean<LearningMaterialDoc[]>();
    return this.materialDtos(mats);
  }

  async materialDtos(mats: LearningMaterialDoc[]): Promise<LearningMaterial[]> {
    if (!mats.length) return [];
    const vs = await this.versions
      .find(
        {
          institutionId: { $in: [...new Set(mats.map((m) => String(m.institutionId)))].map(oid) },
          materialId: { $in: mats.map((m) => m._id) },
        },
        { body: 0, provenance: 0 },
      )
      .sort({ versionNumber: -1 })
      .lean<ContentVersionDoc[]>();
    return mats.map((m) => ({
      id: String(m._id),
      courseId: String(m.courseId),
      topicId: String(m.topicId),
      kind: m.kind,
      title: m.title,
      displayStatus: m.displayStatus,
      publication: { state: m.publication.state },
      currentDraftVersionId: m.currentDraftVersionId ? String(m.currentDraftVersionId) : null,
      latestApprovedVersionId: m.latestApprovedVersionId ? String(m.latestApprovedVersionId) : null,
      publishedVersionId: m.publishedVersionId ? String(m.publishedVersionId) : null,
      versions: vs
        .filter((v) => String(v.materialId) === String(m._id))
        .map((v) => ({
          id: String(v._id),
          versionNumber: v.versionNumber,
          generationStatus: v.generationStatus,
          reviewStatus: v.reviewStatus,
          origin: v.origin,
          createdAt: v.createdAt.toISOString(),
        })),
      updatedAt: m.updatedAt.toISOString(),
    }));
  }

  async getVersion(scope: TenantScope, id: string): Promise<ContentVersion> {
    return this.versionDto(await this.loadVersion(scope, id));
  }

  async versionDto(v: ContentVersionDoc): Promise<ContentVersion> {
    const [reviews, course, topic] = await Promise.all([
      this.reviews
        .find({ institutionId: v.institutionId, versionId: v._id })
        .sort({ createdAt: -1 })
        .lean<ContentReviewDoc[]>(),
      this.courseModel
        .findOne({ _id: v.courseId, institutionId: v.institutionId }, { code: 1, title: 1 })
        .lean<CourseDoc>(),
      this.topics
        .findOne({ _id: v.topicId, institutionId: v.institutionId }, { title: 1 })
        .lean<TopicDoc>(),
    ]);
    const names = await this.userNames(reviews.map((r) => r.reviewerId));
    const g = v.generation;
    return {
      id: String(v._id),
      materialId: String(v.materialId),
      courseId: String(v.courseId),
      topicId: String(v.topicId),
      kind: v.kind,
      versionNumber: v.versionNumber,
      parentVersionId: v.parentVersionId ? String(v.parentVersionId) : null,
      origin: v.origin,
      generationStatus: v.generationStatus,
      reviewStatus: v.reviewStatus,
      frozen: !!v.frozenAt,
      body: (v.body as VersionBody | null) ?? null,
      provenance: {
        citations: (v.provenance?.citations ?? []).map((c) => ({
          ...c,
          sourceDocumentId: String(c.sourceDocumentId),
          chunkId: String(c.chunkId),
          page: c.page ?? null,
        })),
        insufficientSources: !!v.provenance?.insufficientSources,
        missingTopics: v.provenance?.missingTopics ?? [],
        warnings: v.provenance?.warnings ?? [],
      },
      generation: g
        ? {
            provider: g.provider,
            model: g.model,
            taskKey: g.taskKey,
            promptVersion: g.promptVersion,
            jobId: g.jobId ? String(g.jobId) : null,
            error: g.error ?? null,
          }
        : null,
      autosaveRev: v.autosaveRev,
      createdBy: v.createdBy ? String(v.createdBy) : null,
      submittedBy: v.submittedBy ? String(v.submittedBy) : null,
      submittedAt: v.submittedAt?.toISOString() ?? null,
      approvedBy: v.approvedBy ? String(v.approvedBy) : null,
      approvedAt: v.approvedAt?.toISOString() ?? null,
      reviews: reviews.map((r) => ({
        id: String(r._id),
        reviewerId: String(r.reviewerId),
        reviewerName: names.get(String(r.reviewerId)) ?? 'Reviewer',
        decision: r.decision,
        comment: r.comment,
        checklist: r.checklist,
        createdAt: r.createdAt.toISOString(),
      })),
      context: {
        courseCode: course?.code ?? '',
        courseTitle: course?.title ?? '',
        topicTitle: topic?.title ?? '',
        institutionId: String(v.institutionId),
      },
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  private async userNames(ids: Types.ObjectId[]) {
    if (!ids.length) return new Map<string, string>();
    const us = await this.users
      .find({ _id: { $in: ids } }, { profile: 1, email: 1 })
      .lean<UserDoc[]>();
    return new Map(
      us.map((u) => [
        String(u._id),
        [u.profile.firstName, u.profile.lastName].filter(Boolean).join(' ') || u.email,
      ]),
    );
  }

  /* ───────────── editing ───────────── */

  /** Autosave with optimistic concurrency: `autosaveRev` must match (412 otherwise). */
  async updateDraft(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: { autosaveRev: number; body: VersionBody },
  ): Promise<ContentVersion> {
    const v = await this.loadVersion(scope, id);
    if (v.frozenAt || v.reviewStatus !== 'draft')
      throw new AppError(
        'VERSION_FROZEN',
        'This version is locked. Create a new draft to make changes.',
      );
    if (!['none', 'generated'].includes(v.generationStatus))
      throw AppError.conflict('Wait for generation to finish before editing');
    if (input.body.kind !== bodyKindFor(v.kind))
      throw new AppError('VALIDATION_FAILED', 'Body does not match the material type', [
        { path: 'body.kind', issue: 'mismatch' },
      ]);
    let body: Record<string, unknown> = input.body;
    if (input.body.kind === 'quiz') {
      // Reorder, remove or change settings only: adding questions goes through composition (approved only).
      const current = new Set(
        ((v.body as { questionRefs?: { questionId: string }[] })?.questionRefs ?? []).map(
          (r) => r.questionId,
        ),
      );
      if (input.body.questionRefs.some((r) => !current.has(r.questionId)))
        throw new AppError(
          'VALIDATION_FAILED',
          'New questions must be added by composing a quiz from approved questions',
          [{ path: 'body.questionRefs', issue: 'not_allowed' }],
        );
      if (!input.body.questionRefs.length)
        throw new AppError('VALIDATION_FAILED', 'A quiz needs at least one question', [
          { path: 'body.questionRefs', issue: 'empty' },
        ]);
    }
    if (input.body.kind === 'notes') {
      const doc = sanitizeDoc(input.body.doc);
      if (!doc || doc.type !== 'doc')
        throw new AppError('VALIDATION_FAILED', 'Invalid document', [
          { path: 'body.doc', issue: 'invalid' },
        ]);
      if (JSON.stringify(doc).length > MAX_DOC_BYTES)
        throw new AppError('VALIDATION_FAILED', 'The document is too large', [
          { path: 'body.doc', issue: 'too_large' },
        ]);
      body = { kind: 'notes', doc, ...docStats(doc) };
    }
    const r = await this.versions.updateOne(
      {
        _id: v._id,
        institutionId: v.institutionId,
        frozenAt: null,
        autosaveRev: input.autosaveRev,
      },
      {
        $set: { body, updatedBy: actor.userId ? oid(actor.userId) : null },
        $inc: { autosaveRev: 1 },
      },
    );
    if (r.matchedCount === 0)
      throw new AppError(
        'PRECONDITION_FAILED',
        'This draft was changed elsewhere. Reload to see the latest version.',
      );
    return this.getVersion(scope, id);
  }

  async submit(actor: Actor, scope: TenantScope, id: string): Promise<ContentVersion> {
    const v = await this.loadVersion(scope, id);
    if (v.reviewStatus !== 'draft' || v.frozenAt)
      throw new AppError('INVALID_TRANSITION', 'Only drafts can be submitted');
    if (!['none', 'generated'].includes(v.generationStatus) || !v.body)
      throw new AppError('INVALID_TRANSITION', 'There is no content to submit yet');
    const hash = createHash('sha256').update(JSON.stringify(v.body)).digest('hex');
    await this.versions.updateOne(
      { _id: v._id, institutionId: v.institutionId, reviewStatus: 'draft' },
      {
        $set: {
          reviewStatus: 'in_review',
          frozenAt: new Date(),
          submittedBy: actor.userId ? oid(actor.userId) : null,
          submittedAt: new Date(),
          contentHash: hash,
        },
      },
    );
    await this.refreshStatus(v.materialId, v.institutionId);
    await this.audit.record({
      actor,
      action: 'content.submit_review',
      target: { type: 'content_version', id },
      institutionId: v.institutionId,
    });
    return this.getVersion(scope, id);
  }

  async withdraw(actor: Actor, scope: TenantScope, id: string): Promise<ContentVersion> {
    const v = await this.loadVersion(scope, id);
    if (v.reviewStatus !== 'in_review')
      throw new AppError('INVALID_TRANSITION', 'Only versions in review can be withdrawn');
    if (String(v.submittedBy) !== actor.userId)
      throw AppError.forbidden('Only the person who submitted it can withdraw it');
    if (await this.reviews.exists({ institutionId: v.institutionId, versionId: v._id }))
      throw new AppError('INVALID_TRANSITION', 'A reviewer has already responded');
    await this.versions.updateOne(
      { _id: v._id, institutionId: v.institutionId, reviewStatus: 'in_review' },
      { $set: { reviewStatus: 'draft', frozenAt: null, submittedBy: null, submittedAt: null } },
    );
    await this.refreshStatus(v.materialId, v.institutionId);
    await this.audit.record({
      actor,
      action: 'content.withdraw',
      target: { type: 'content_version', id },
      institutionId: v.institutionId,
    });
    return this.getVersion(scope, id);
  }

  /** Separation of duties: the author or submitter can never approve (docs/03 §5). */
  async review(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof ReviewDecisionSchema>,
  ): Promise<ContentVersion> {
    const v = await this.loadVersion(scope, id);
    if (v.reviewStatus !== 'in_review')
      throw new AppError('INVALID_TRANSITION', 'This version is not awaiting review');
    if (
      actor.userId &&
      [String(v.submittedBy), String(v.createdBy), String(v.updatedBy)].includes(actor.userId)
    ) {
      throw new AppError(
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot review content you created, edited or submitted',
      );
    }
    await this.reviews.create({
      institutionId: v.institutionId,
      versionId: v._id,
      materialId: v.materialId,
      reviewerId: oid(actor.userId!),
      decision: input.decision,
      comment: input.comment,
      checklist: input.checklist,
    });
    const approved = input.decision === 'approved';
    await this.versions.updateOne(
      { _id: v._id, institutionId: v.institutionId, reviewStatus: 'in_review' },
      {
        $set: {
          reviewStatus: input.decision,
          ...(approved ? { approvedBy: oid(actor.userId!), approvedAt: new Date() } : {}),
        },
      },
    );
    await this.materials.updateOne(
      { _id: v.materialId, institutionId: v.institutionId },
      {
        $set: { ...(approved ? { latestApprovedVersionId: v._id } : {}) },
        ...(await this.clearDraftPointer(v)),
      },
    );
    await this.refreshStatus(v.materialId, v.institutionId);
    await this.audit.record({
      actor,
      action: `content.review.${input.decision}`,
      target: { type: 'content_version', id },
      institutionId: v.institutionId,
      after: { comment: input.comment },
    });
    return this.getVersion(scope, id);
  }

  private async clearDraftPointer(v: ContentVersionDoc) {
    const m = await this.materials
      .findOne({ _id: v.materialId, institutionId: v.institutionId }, { currentDraftVersionId: 1 })
      .lean<LearningMaterialDoc>();
    return m && String(m.currentDraftVersionId) === String(v._id)
      ? { $unset: { currentDraftVersionId: 1 } }
      : {};
  }

  /** New editable draft from any version (how approved or reviewed content gets changed). */
  async fork(actor: Actor, scope: TenantScope, id: string): Promise<ContentVersion> {
    const v = await this.loadVersion(scope, id);
    if (!v.body) throw AppError.conflict('This version has no content to copy');
    const material = (await this.materials
      .findOne({ _id: v.materialId, institutionId: v.institutionId })
      .lean<LearningMaterialDoc>())!;
    if (material.currentDraftVersionId) {
      const draft = await this.versions
        .findOne(
          { _id: material.currentDraftVersionId, institutionId: v.institutionId },
          { reviewStatus: 1, versionNumber: 1 },
        )
        .lean<ContentVersionDoc>();
      if (draft?.reviewStatus === 'draft')
        throw new AppError('CONFLICT', `Version ${draft.versionNumber} is already an open draft`, [
          { path: 'versionId', issue: String(draft._id) },
        ]);
    }
    const copy = await this.createVersion(material, {
      origin: v.origin === 'manual' ? 'manual' : 'ai_assisted_edit',
      parentVersionId: v._id,
      generationStatus: 'none',
      body: v.body,
      provenance: v.provenance,
      createdBy: actor.userId ? oid(actor.userId) : null,
      updatedBy: actor.userId ? oid(actor.userId) : null,
    });
    await this.materials.updateOne(
      { _id: material._id, institutionId: material.institutionId },
      { $set: { currentDraftVersionId: copy._id } },
    );
    await this.refreshStatus(material._id, material.institutionId);
    await this.audit.record({
      actor,
      action: 'content.fork',
      target: { type: 'content_version', id: copy._id },
      institutionId: v.institutionId,
      after: { from: v.versionNumber },
    });
    return this.getVersion(scope, String(copy._id));
  }

  /* ───────────── review queue ───────────── */

  async reviewQueue(scope: TenantScope) {
    const vs = await this.versions
      .find({ ...institutionFilter(scope), reviewStatus: 'in_review' }, { body: 0 })
      .sort({ submittedAt: 1 })
      .limit(200)
      .lean<ContentVersionDoc[]>();
    if (!vs.length) return [];
    const inst = {
      institutionId: { $in: [...new Set(vs.map((v) => String(v.institutionId)))].map(oid) },
    };
    const [courses, topics, names] = await Promise.all([
      this.courseModel
        .find({ ...inst, _id: { $in: vs.map((v) => v.courseId) } }, { code: 1, title: 1 })
        .lean<CourseDoc[]>(),
      this.topics
        .find({ ...inst, _id: { $in: vs.map((v) => v.topicId) } }, { title: 1 })
        .lean<TopicDoc[]>(),
      this.userNames(vs.map((v) => v.submittedBy).filter((x): x is Types.ObjectId => !!x)),
    ]);
    const c = new Map(courses.map((x) => [String(x._id), x]));
    const t = new Map(topics.map((x) => [String(x._id), x.title]));
    return vs.map((v) => ({
      versionId: String(v._id),
      materialId: String(v.materialId),
      kind: v.kind,
      versionNumber: v.versionNumber,
      courseId: String(v.courseId),
      courseCode: c.get(String(v.courseId))?.code ?? '',
      courseTitle: c.get(String(v.courseId))?.title ?? '',
      topicTitle: t.get(String(v.topicId)) ?? '',
      submittedAt: v.submittedAt?.toISOString() ?? null,
      submittedByName: v.submittedBy ? (names.get(String(v.submittedBy)) ?? 'Unknown') : 'Unknown',
      insufficientSources: !!v.provenance?.insufficientSources,
    }));
  }

  /* ───────────── display status (docs/05 §3) ───────────── */

  async refreshStatus(materialId: Types.ObjectId, institutionId: Types.ObjectId): Promise<void> {
    const [m, latest] = await Promise.all([
      this.materials.findOne({ _id: materialId, institutionId }).lean<LearningMaterialDoc>(),
      this.versions
        .findOne({ institutionId, materialId }, { generationStatus: 1, reviewStatus: 1 })
        .sort({ versionNumber: -1 })
        .lean<ContentVersionDoc>(),
    ]);
    if (!m) return;
    let status: DisplayStatus = 'draft';
    if (m.publication.state === 'archived') status = 'archived';
    else if (latest && ['queued', 'generating'].includes(latest.generationStatus))
      status = 'generating';
    else if (latest?.generationStatus === 'failed') status = 'failed';
    else if (m.publication.state === 'published')
      status =
        latest &&
        String(latest._id) !== String(m.publishedVersionId) &&
        ['draft', 'in_review'].includes(latest.reviewStatus)
          ? 'published_with_draft'
          : 'published';
    else if (m.publication.state === 'scheduled') status = 'scheduled';
    else if (m.publication.unpublishedAt && latest?.reviewStatus === 'approved')
      status = 'unpublished';
    else if (latest) status = latest.reviewStatus === 'approved' ? 'approved' : latest.reviewStatus;
    await this.materials.updateOne(
      { _id: materialId, institutionId },
      { $set: { displayStatus: status } },
    );
  }
}
