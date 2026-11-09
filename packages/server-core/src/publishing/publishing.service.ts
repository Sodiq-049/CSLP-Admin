import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type { z } from 'zod';
import type { PublishBundleSchema, PublishingItem } from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import type { CourseDoc, TopicDoc } from '../courses/course.schemas.js';
import type { ContentVersionDoc, LearningMaterialDoc } from '../content/content.schemas.js';
import { ContentService, KIND_LABEL } from '../content/content.service.js';
import type { QuestionDoc } from '../quizzes/question.schema.js';
import type { UserDoc } from '../identity/identity.schemas.js';
import type { PublicationAction, PublicationEventDoc } from './publication-event.schema.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const MIN_SCHEDULE_MS = 2 * 60 * 1000;

/**
 * The ONLY code that changes what students can see (docs/05 §5). Every rule is enforced here,
 * never in the UI.
 */
@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MODELS.LearningMaterial) private readonly materials: Model<LearningMaterialDoc>,
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.Question) private readonly questions: Model<QuestionDoc>,
    @InjectModel(MODELS.PublicationEvent) private readonly events: Model<PublicationEventDoc>,
    @InjectModel(MODELS.User) private readonly users: Model<UserDoc>,
    private readonly content: ContentService,
    private readonly audit: AuditLogService,
  ) {}

  /* ───────────── loading & validation ───────────── */

  async resolveMaterialInstitution(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const m = await this.materials
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return m ? String(m.institutionId) : null;
  }

  private async loadMaterial(scope: TenantScope, id: string): Promise<LearningMaterialDoc> {
    const inst = await this.resolveMaterialInstitution(id);
    if (!inst) throw AppError.notFound('Material');
    assertInstitutionAccess(scope, inst);
    return (await this.materials
      .findOne({ _id: oid(id), institutionId: oid(inst) })
      .lean<LearningMaterialDoc>())!;
  }

  /** Publishable = approved version of this material; quizzes also need every pinned question approved. */
  private async publishableVersion(
    m: LearningMaterialDoc,
    versionId: string,
    opts: { allowPreviouslyPublished?: boolean } = {},
  ): Promise<ContentVersionDoc> {
    const v = await this.versions
      .findOne({ _id: oid(versionId), institutionId: m.institutionId })
      .lean<ContentVersionDoc>();
    if (!v || String(v.materialId) !== String(m._id))
      throw AppError.conflict('That version does not belong to this material', [
        { path: 'versionId', issue: 'mismatch' },
      ]);
    if (v.reviewStatus !== 'approved' && !opts.allowPreviouslyPublished)
      throw new AppError('CONTENT_NOT_APPROVED', 'Only approved versions can be published');
    if (v.reviewStatus !== 'approved') {
      const wasPublished = await this.events.exists({
        institutionId: m.institutionId,
        'target.id': m._id,
        toVersionId: v._id,
        action: { $in: ['publish', 'rollback'] },
      });
      if (!wasPublished)
        throw new AppError(
          'CONTENT_NOT_APPROVED',
          'You can only roll back to a version that was approved or previously published',
        );
    }
    if (v.kind === 'quiz') {
      const refs = (
        (v.body as { questionRefs?: { questionId: string }[] })?.questionRefs ?? []
      ).map((r) => oid(r.questionId));
      const approved = await this.questions.countDocuments({
        institutionId: m.institutionId,
        _id: { $in: refs },
        reviewStatus: 'approved',
      });
      if (approved !== refs.length)
        throw new AppError('CONTENT_NOT_APPROVED', 'Every question in the quiz must be approved');
    }
    return v;
  }

  private async event(
    m: { institutionId: Types.ObjectId; courseId: Types.ObjectId },
    e: {
      action: PublicationAction;
      target: PublicationEventDoc['target'];
      label: string;
      from?: ContentVersionDoc | null;
      to?: ContentVersionDoc | null;
      reason?: string | null;
      bundleId?: string | null;
    },
    actor: Actor,
    session?: ClientSession,
  ) {
    await this.events.create(
      [
        {
          institutionId: m.institutionId,
          courseId: m.courseId,
          action: e.action,
          target: e.target,
          label: e.label,
          fromVersionId: e.from?._id ?? null,
          fromVersionNumber: e.from?.versionNumber ?? null,
          toVersionId: e.to?._id ?? null,
          toVersionNumber: e.to?.versionNumber ?? null,
          reason: e.reason ?? null,
          bundleId: e.bundleId ?? null,
          actorId: actor.userId ? oid(actor.userId) : null,
        },
      ],
      { session },
    );
  }

  private async materialLabel(m: LearningMaterialDoc) {
    const t = await this.topics
      .findOne({ _id: m.topicId, institutionId: m.institutionId }, { title: 1 })
      .lean<TopicDoc>();
    return `${t?.title ?? 'Topic'} · ${KIND_LABEL[m.kind]}`;
  }

  private async currentVersion(m: LearningMaterialDoc) {
    return m.publishedVersionId
      ? this.versions
          .findOne(
            { _id: m.publishedVersionId, institutionId: m.institutionId },
            { versionNumber: 1 },
          )
          .lean<ContentVersionDoc>()
      : null;
  }

  /* ───────────── materials ───────────── */

  async publish(
    actor: Actor,
    scope: TenantScope,
    materialId: string,
    versionId: string,
    session?: ClientSession,
    bundleId?: string,
  ) {
    const m = await this.loadMaterial(scope, materialId);
    const v = await this.publishableVersion(m, versionId);
    const from = await this.currentVersion(m);
    await this.materials.updateOne(
      { _id: m._id, institutionId: m.institutionId },
      {
        $set: {
          publishedVersionId: v._id,
          'publication.state': 'published',
          'publication.publishedAt': new Date(),
          'publication.publishedBy': actor.userId ? oid(actor.userId) : null,
          'publication.scheduledFor': null,
          'publication.scheduledVersionId': null,
          'publication.unpublishedAt': null,
        },
      },
      { session },
    );
    await this.event(
      m,
      {
        action: 'publish',
        target: { type: 'material', id: m._id },
        label: await this.materialLabel(m),
        from,
        to: v,
        bundleId,
      },
      actor,
      session,
    );
    if (!session) await this.afterChange(actor, m, 'content.publish', { version: v.versionNumber });
    return this.state(m._id, m.institutionId);
  }

  async schedule(
    actor: Actor,
    scope: TenantScope,
    materialId: string,
    versionId: string,
    publishAt: Date,
  ) {
    if (publishAt.getTime() < Date.now() + MIN_SCHEDULE_MS)
      throw new AppError('VALIDATION_FAILED', 'Schedule at least 2 minutes ahead', [
        { path: 'publishAt', issue: 'too_soon' },
      ]);
    const m = await this.loadMaterial(scope, materialId);
    const v = await this.publishableVersion(m, versionId);
    await this.materials.updateOne(
      { _id: m._id, institutionId: m.institutionId },
      {
        $set: {
          'publication.state': m.publication.state === 'published' ? 'published' : 'scheduled',
          'publication.scheduledFor': publishAt,
          'publication.scheduledVersionId': v._id,
        },
      },
    );
    await this.event(
      m,
      {
        action: 'schedule',
        target: { type: 'material', id: m._id },
        label: await this.materialLabel(m),
        to: v,
        reason: `For ${publishAt.toISOString()}`,
      },
      actor,
    );
    await this.afterChange(actor, m, 'content.schedule', { version: v.versionNumber, publishAt });
    return this.state(m._id, m.institutionId);
  }

  async cancelSchedule(actor: Actor, scope: TenantScope, materialId: string) {
    const m = await this.loadMaterial(scope, materialId);
    if (!m.publication.scheduledFor)
      throw new AppError('INVALID_TRANSITION', 'Nothing is scheduled');
    await this.materials.updateOne(
      { _id: m._id, institutionId: m.institutionId },
      {
        $set: {
          'publication.state': m.publishedVersionId ? 'published' : 'unpublished',
          'publication.scheduledFor': null,
          'publication.scheduledVersionId': null,
        },
      },
    );
    await this.event(
      m,
      {
        action: 'cancel_schedule',
        target: { type: 'material', id: m._id },
        label: await this.materialLabel(m),
      },
      actor,
    );
    await this.afterChange(actor, m, 'content.cancel_schedule', {});
    return this.state(m._id, m.institutionId);
  }

  /** Called by the worker every minute (and on demand): publishes due schedules after re-checking approval. */
  async runDueSchedules(now = new Date()): Promise<number> {
    const due = await this.materials
      .find({
        'publication.scheduledFor': { $lte: now },
        'publication.scheduledVersionId': { $ne: null },
      })
      .setOptions({ crossTenant: true })
      .lean<LearningMaterialDoc[]>();
    let done = 0;
    for (const m of due) {
      const system: Actor = { userId: null, roles: ['scheduler'] };
      try {
        await this.publish(
          system,
          { kind: 'all' },
          String(m._id),
          String(m.publication.scheduledVersionId),
        );
        done++;
      } catch (err) {
        this.logger.warn({ err, materialId: String(m._id) }, 'Scheduled publish skipped');
        await this.materials.updateOne(
          { _id: m._id, institutionId: m.institutionId },
          {
            $set: {
              'publication.state': m.publishedVersionId ? 'published' : 'unpublished',
              'publication.scheduledFor': null,
              'publication.scheduledVersionId': null,
            },
          },
        );
        await this.event(
          m,
          {
            action: 'cancel_schedule',
            target: { type: 'material', id: m._id },
            label: await this.materialLabel(m),
            reason: `Not published: ${(err as Error).message}`,
          },
          system,
        );
      }
    }
    return done;
  }

  async unpublish(actor: Actor, scope: TenantScope, materialId: string, reason: string) {
    const m = await this.loadMaterial(scope, materialId);
    if (m.publication.state !== 'published')
      throw new AppError('INVALID_TRANSITION', 'This material is not published');
    const from = await this.currentVersion(m);
    await this.materials.updateOne(
      { _id: m._id, institutionId: m.institutionId },
      {
        $set: {
          publishedVersionId: null,
          'publication.state': 'unpublished',
          'publication.unpublishedAt': new Date(),
          'publication.scheduledFor': null,
          'publication.scheduledVersionId': null,
        },
      },
    );
    await this.event(
      m,
      {
        action: 'unpublish',
        target: { type: 'material', id: m._id },
        label: await this.materialLabel(m),
        from,
        reason,
      },
      actor,
    );
    await this.afterChange(actor, m, 'content.unpublish', { reason });
    return this.state(m._id, m.institutionId);
  }

  /** Rollback = pointer change to an earlier approved/published version; nothing is copied or deleted. */
  async rollback(
    actor: Actor,
    scope: TenantScope,
    materialId: string,
    toVersionId: string,
    reason: string,
  ) {
    const m = await this.loadMaterial(scope, materialId);
    if (!m.publishedVersionId)
      throw new AppError('INVALID_TRANSITION', 'Only published materials can be rolled back');
    if (String(m.publishedVersionId) === toVersionId)
      throw AppError.conflict('That version is already published');
    const v = await this.publishableVersion(m, toVersionId, { allowPreviouslyPublished: true });
    const from = await this.currentVersion(m);
    await this.materials.updateOne(
      { _id: m._id, institutionId: m.institutionId },
      { $set: { publishedVersionId: v._id, 'publication.publishedAt': new Date() } },
    );
    await this.event(
      m,
      {
        action: 'rollback',
        target: { type: 'material', id: m._id },
        label: await this.materialLabel(m),
        from,
        to: v,
        reason,
      },
      actor,
    );
    await this.afterChange(actor, m, 'content.rollback', { to: v.versionNumber, reason });
    return this.state(m._id, m.institutionId);
  }

  private async afterChange(actor: Actor, m: LearningMaterialDoc, action: string, after: object) {
    await this.content.refreshStatus(m._id, m.institutionId);
    await this.audit.record({
      actor,
      action,
      target: { type: 'material', id: m._id },
      institutionId: m.institutionId,
      after,
    });
  }

  private async state(id: Types.ObjectId, institutionId: Types.ObjectId) {
    const m = (await this.materials
      .findOne({ _id: id, institutionId })
      .lean<LearningMaterialDoc>())!;
    return {
      id: String(m._id),
      state: m.publication.state,
      publishedVersionId: m.publishedVersionId ? String(m.publishedVersionId) : null,
      scheduledFor: m.publication.scheduledFor?.toISOString() ?? null,
    };
  }

  /* ───────────── courses & topics (visibility containers) ───────────── */

  async setCourse(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    publish: boolean,
    session?: ClientSession,
    bundleId?: string,
  ) {
    const c = await this.courses
      .findOne({ _id: oid(courseId) })
      .setOptions({ crossTenant: true })
      .lean<CourseDoc>();
    if (!c) throw AppError.notFound('Course');
    assertInstitutionAccess(scope, c.institutionId);
    if (publish) {
      if (c.archivedAt) throw AppError.conflict('Archived courses cannot be published');
      const hasTopic = await this.topics.exists({
        institutionId: c.institutionId,
        courseId: c._id,
        archivedAt: null,
      });
      if (!hasTopic)
        throw new AppError(
          'VALIDATION_FAILED',
          'Add at least one topic before publishing the course',
          [{ path: 'courseId', issue: 'no_topics' }],
        );
    }
    await this.courses.updateOne(
      { _id: c._id, institutionId: c.institutionId },
      {
        $set: {
          'publication.state': publish ? 'published' : 'unpublished',
          ...(publish
            ? {
                'publication.publishedAt': new Date(),
                'publication.publishedBy': actor.userId ? oid(actor.userId) : null,
              }
            : {}),
        },
      },
      { session },
    );
    await this.event(
      { institutionId: c.institutionId, courseId: c._id },
      {
        action: publish ? 'publish_course' : 'unpublish_course',
        target: { type: 'course', id: c._id },
        label: `${c.code} ${c.title}`,
        bundleId,
      },
      actor,
      session,
    );
    if (!session)
      await this.audit.record({
        actor,
        action: publish ? 'course.publish' : 'course.unpublish',
        target: { type: 'course', id: c._id },
        institutionId: c.institutionId,
      });
    return {
      id: String(c._id),
      state: publish ? ('published' as const) : ('unpublished' as const),
      publishedVersionId: null,
      scheduledFor: null,
    };
  }

  async setTopic(
    actor: Actor,
    scope: TenantScope,
    topicId: string,
    publish: boolean,
    session?: ClientSession,
    bundleId?: string,
  ) {
    const t = await this.topics
      .findOne({ _id: oid(topicId) })
      .setOptions({ crossTenant: true })
      .lean<TopicDoc>();
    if (!t) throw AppError.notFound('Topic');
    assertInstitutionAccess(scope, t.institutionId);
    if (publish && t.archivedAt) throw AppError.conflict('Archived topics cannot be published');
    await this.topics.updateOne(
      { _id: t._id, institutionId: t.institutionId },
      {
        $set: {
          'publication.state': publish ? 'published' : 'unpublished',
          ...(publish ? { 'publication.publishedAt': new Date() } : {}),
        },
      },
      { session },
    );
    await this.event(
      { institutionId: t.institutionId, courseId: t.courseId },
      {
        action: publish ? 'publish_topic' : 'unpublish_topic',
        target: { type: 'topic', id: t._id },
        label: t.title,
        bundleId,
      },
      actor,
      session,
    );
    if (!session)
      await this.audit.record({
        actor,
        action: publish ? 'topic.publish' : 'topic.unpublish',
        target: { type: 'topic', id: t._id },
        institutionId: t.institutionId,
      });
    return {
      id: String(t._id),
      state: publish ? ('published' as const) : ('unpublished' as const),
      publishedVersionId: null,
      scheduledFor: null,
    };
  }

  /** All-or-nothing: validate everything first, then apply inside one MongoDB transaction. */
  async bundle(actor: Actor, scope: TenantScope, input: z.output<typeof PublishBundleSchema>) {
    const course = await this.courses
      .findOne({ _id: oid(input.courseId) })
      .setOptions({ crossTenant: true })
      .lean<CourseDoc>();
    if (!course) throw AppError.notFound('Course');
    assertInstitutionAccess(scope, course.institutionId);
    for (const item of input.items) {
      const m = await this.loadMaterial(scope, item.materialId);
      if (String(m.courseId) !== String(course._id))
        throw new AppError('VALIDATION_FAILED', 'Every item must belong to the course', [
          { path: 'items', issue: item.materialId },
        ]);
      await this.publishableVersion(m, item.versionId);
    }
    for (const id of input.topicIds) {
      const t = await this.topics
        .findOne({
          _id: oid(id),
          institutionId: course.institutionId,
          courseId: course._id,
          archivedAt: null,
        })
        .lean();
      if (!t)
        throw new AppError('VALIDATION_FAILED', 'Every topic must belong to the course', [
          { path: 'topicIds', issue: id },
        ]);
    }
    const bundleId = randomUUID();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const id of input.topicIds)
          await this.setTopic(actor, scope, id, true, session, bundleId);
        for (const item of input.items)
          await this.publish(actor, scope, item.materialId, item.versionId, session, bundleId);
        if (input.publishCourse)
          await this.setCourse(actor, scope, String(course._id), true, session, bundleId);
      });
    } finally {
      await session.endSession();
    }
    for (const item of input.items)
      await this.content.refreshStatus(oid(item.materialId), course.institutionId);
    await this.audit.record({
      actor,
      action: 'content.publish_bundle',
      target: { type: 'course', id: course._id },
      institutionId: course.institutionId,
      after: {
        items: input.items.length,
        topics: input.topicIds.length,
        course: input.publishCourse,
      },
    });
    return { bundleId, published: input.items.length };
  }

  /* ───────────── overview & history ───────────── */

  async overview(scope: TenantScope, institutionId?: string) {
    const mats = await this.materials
      .find({
        ...institutionFilter(scope, institutionId),
        $or: [
          { latestApprovedVersionId: { $ne: null } },
          { publishedVersionId: { $ne: null } },
          { 'publication.scheduledFor': { $ne: null } },
        ],
      })
      .sort({ updatedAt: -1 })
      .limit(300)
      .lean<LearningMaterialDoc[]>();
    if (!mats.length) return { ready: [], scheduled: [], published: [] };
    const inst = {
      institutionId: { $in: [...new Set(mats.map((m) => String(m.institutionId)))].map(oid) },
    };
    const versionIds = mats
      .flatMap((m) => [m.publishedVersionId, m.latestApprovedVersionId])
      .filter((x): x is Types.ObjectId => !!x);
    const [courses, topics, versions] = await Promise.all([
      this.courses
        .find(
          { ...inst, _id: { $in: mats.map((m) => m.courseId) } },
          { code: 1, title: 1, publication: 1 },
        )
        .lean<CourseDoc[]>(),
      this.topics
        .find({ ...inst, _id: { $in: mats.map((m) => m.topicId) } }, { title: 1, publication: 1 })
        .lean<TopicDoc[]>(),
      this.versions
        .find({ ...inst, _id: { $in: versionIds } }, { versionNumber: 1 })
        .lean<ContentVersionDoc[]>(),
    ]);
    const c = new Map(courses.map((x) => [String(x._id), x]));
    const t = new Map(topics.map((x) => [String(x._id), x]));
    const vn = new Map(versions.map((x) => [String(x._id), x.versionNumber]));
    const item = (m: LearningMaterialDoc): PublishingItem => ({
      materialId: String(m._id),
      kind: m.kind,
      courseId: String(m.courseId),
      courseCode: c.get(String(m.courseId))?.code ?? '',
      courseTitle: c.get(String(m.courseId))?.title ?? '',
      coursePublished: c.get(String(m.courseId))?.publication.state === 'published',
      topicId: String(m.topicId),
      topicTitle: t.get(String(m.topicId))?.title ?? '',
      topicPublished: t.get(String(m.topicId))?.publication?.state === 'published',
      state: m.publication.state,
      publishedVersionId: m.publishedVersionId ? String(m.publishedVersionId) : null,
      publishedVersionNumber: m.publishedVersionId
        ? (vn.get(String(m.publishedVersionId)) ?? null)
        : null,
      latestApprovedVersionId: m.latestApprovedVersionId ? String(m.latestApprovedVersionId) : null,
      latestApprovedVersionNumber: m.latestApprovedVersionId
        ? (vn.get(String(m.latestApprovedVersionId)) ?? null)
        : null,
      scheduledFor: m.publication.scheduledFor?.toISOString() ?? null,
      publishedAt: m.publication.publishedAt?.toISOString() ?? null,
    });
    return {
      ready: mats
        .filter(
          (m) =>
            m.latestApprovedVersionId &&
            String(m.latestApprovedVersionId) !== String(m.publishedVersionId) &&
            !m.publication.scheduledFor,
        )
        .map(item),
      scheduled: mats.filter((m) => m.publication.scheduledFor).map(item),
      published: mats.filter((m) => m.publishedVersionId).map(item),
    };
  }

  async history(
    scope: TenantScope,
    q: { institutionId?: string; courseId?: string; page: number; pageSize: number },
  ) {
    const f: Record<string, unknown> = { ...institutionFilter(scope, q.institutionId) };
    if (q.courseId) f.courseId = oid(q.courseId);
    const [items, total] = await Promise.all([
      this.events
        .find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<PublicationEventDoc[]>(),
      this.events.countDocuments(f),
    ]);
    const users = await this.users
      .find({ _id: { $in: items.map((e) => e.actorId).filter(Boolean) } }, { profile: 1, email: 1 })
      .lean<UserDoc[]>();
    const names = new Map(
      users.map((u) => [
        String(u._id),
        [u.profile.firstName, u.profile.lastName].filter(Boolean).join(' ') || u.email,
      ]),
    );
    return {
      total,
      items: items.map((e) => ({
        id: String(e._id),
        action: e.action,
        target: { type: e.target.type, id: String(e.target.id) },
        label: e.label,
        fromVersionNumber: e.fromVersionNumber ?? null,
        toVersionNumber: e.toVersionNumber ?? null,
        reason: e.reason ?? null,
        actorName: e.actorId ? (names.get(String(e.actorId)) ?? 'Unknown') : 'Scheduler',
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
