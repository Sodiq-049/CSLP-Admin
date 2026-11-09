import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type {
  CreateTopicSchema,
  MoveTopicSchema,
  Topic,
  TopicTreeNode,
  UpdateTopicSchema,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { orderKeyBetween } from '../database/order-key.js';
import { AppError } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import { assertInstitutionAccess, type TenantScope } from '../tenancy/tenant-scope.js';
import type { CourseDoc, TopicDoc } from './course.schemas.js';
import { CoursesService, withObjectiveIds } from './courses.service.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'topic';

/** Topics and subtopics (Course → Topic → Subtopic, docs/02 §4). Two levels deep. */
@Injectable()
export class TopicsService {
  constructor(
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    private readonly courses: CoursesService,
    private readonly audit: AuditLogService,
  ) {}

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const t = await this.topics
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return t ? String(t.institutionId) : null;
  }

  async load(scope: TenantScope, id: string): Promise<TopicDoc> {
    const institutionId = await this.resolveInstitutionId(id);
    if (!institutionId) throw AppError.notFound('Topic');
    assertInstitutionAccess(scope, institutionId);
    const t = await this.topics
      .findOne({ _id: oid(id), institutionId: oid(institutionId) })
      .lean<TopicDoc>();
    if (!t) throw AppError.notFound('Topic');
    return t;
  }

  async tree(
    scope: TenantScope,
    courseId: string,
    includeArchived = false,
  ): Promise<TopicTreeNode[]> {
    const course = await this.courses.load(scope, courseId);
    const all = await this.topics
      .find({
        institutionId: course.institutionId,
        courseId: course._id,
        ...(includeArchived ? {} : { archivedAt: null }),
      })
      .sort({ orderKey: 1 })
      .lean<TopicDoc[]>();
    const children = new Map<string, TopicDoc[]>();
    for (const t of all)
      if (t.parentTopicId)
        children.set(String(t.parentTopicId), [
          ...(children.get(String(t.parentTopicId)) ?? []),
          t,
        ]);
    return all
      .filter((t) => !t.parentTopicId)
      .map((t) => ({
        ...toTopicDto(t),
        subtopics: (children.get(String(t._id)) ?? []).map(toTopicDto),
      }));
  }

  private async uniqueSlug(course: CourseDoc, title: string): Promise<string> {
    const base = slugify(title);
    const taken = new Set(
      (
        await this.topics
          .find(
            {
              institutionId: course.institutionId,
              courseId: course._id,
              slug: new RegExp(`^${base}(-\\d+)?$`),
            },
            { slug: 1 },
          )
          .lean()
      ).map((t) => t.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private async lastKey(
    course: CourseDoc,
    parentTopicId: Types.ObjectId | null,
  ): Promise<string | null> {
    const last = await this.topics
      .findOne(
        { institutionId: course.institutionId, courseId: course._id, parentTopicId },
        { orderKey: 1 },
      )
      .sort({ orderKey: -1 })
      .lean<{ orderKey: string }>();
    return last?.orderKey ?? null;
  }

  private async loadParent(course: CourseDoc, parentTopicId: string): Promise<TopicDoc> {
    const parent = await this.topics
      .findOne({
        _id: oid(parentTopicId),
        institutionId: course.institutionId,
        courseId: course._id,
        archivedAt: null,
      })
      .lean<TopicDoc>();
    if (!parent)
      throw new AppError('VALIDATION_FAILED', 'Parent topic not found in this course', [
        { path: 'parentTopicId', issue: 'not_found' },
      ]);
    if (parent.depth !== 0)
      throw new AppError('VALIDATION_FAILED', 'Subtopics cannot have their own subtopics', [
        { path: 'parentTopicId', issue: 'too_deep' },
      ]);
    return parent;
  }

  async create(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    input: z.output<typeof CreateTopicSchema> & { outlineNodeKey?: string | null },
  ): Promise<TopicDoc> {
    const course = await this.courses.load(scope, courseId);
    if (course.archivedAt) throw AppError.conflict('Archived courses cannot be edited');
    const parent = input.parentTopicId ? await this.loadParent(course, input.parentTopicId) : null;
    const doc = await this.topics.create({
      institutionId: course.institutionId,
      departmentId: course.departmentId,
      programmeId: course.programmeId,
      courseId: course._id,
      parentTopicId: parent?._id ?? null,
      title: input.title,
      slug: await this.uniqueSlug(course, input.title),
      orderKey: orderKeyBetween(await this.lastKey(course, parent?._id ?? null), null),
      depth: parent ? 1 : 0,
      learningObjectives: withObjectiveIds(input.learningObjectives, 'admin'),
      outlineNodeKey: input.outlineNodeKey ?? null,
      createdBy: actor.userId ? oid(actor.userId) : null,
    });
    const obj = doc.toObject() as TopicDoc;
    await this.audit.record({
      actor,
      action: 'topic.create',
      target: { type: 'topic', id: obj._id },
      institutionId: obj.institutionId,
      after: { title: obj.title, courseId },
    });
    return obj;
  }

  async update(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof UpdateTopicSchema>,
  ): Promise<TopicDoc> {
    const before = await this.load(scope, id);
    const set: Record<string, unknown> = {};
    if (input.title) set.title = input.title; // slug stays stable for student URLs
    if (input.learningObjectives)
      set.learningObjectives = withObjectiveIds(input.learningObjectives, 'admin');
    const after = await this.topics
      .findOneAndUpdate(
        { _id: before._id, institutionId: before.institutionId },
        { $set: set },
        { returnDocument: 'after' },
      )
      .lean<TopicDoc>();
    await this.audit.record({
      actor,
      action: 'topic.update',
      target: { type: 'topic', id },
      institutionId: before.institutionId,
      before,
      after,
    });
    return after!;
  }

  /**
   * Place a topic under `parentTopicId` (null = top level) between the siblings `beforeId` (above)
   * and `afterId` (below). Drag-and-drop and the keyboard "move up/down/indent/outdent" controls
   * all reduce to this call. Only the moved topic's key changes.
   */
  async move(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: z.output<typeof MoveTopicSchema>,
  ): Promise<TopicDoc> {
    const topic = await this.load(scope, id);
    const course = await this.courses.load(scope, String(topic.courseId));
    const parentId = input.parentTopicId ? oid(input.parentTopicId) : null;
    if (parentId) {
      if (String(parentId) === String(topic._id))
        throw new AppError('VALIDATION_FAILED', 'A topic cannot be its own parent', [
          { path: 'parentTopicId', issue: 'invalid' },
        ]);
      await this.loadParent(course, String(parentId));
      const hasChildren = await this.topics.exists({
        institutionId: topic.institutionId,
        parentTopicId: topic._id,
        archivedAt: null,
      });
      if (hasChildren)
        throw new AppError(
          'VALIDATION_FAILED',
          'Move or remove its subtopics before nesting this topic',
          [{ path: 'parentTopicId', issue: 'has_children' }],
        );
    }
    const sibling = async (sid: string | null, path: string) => {
      if (!sid) return null;
      const s = await this.topics
        .findOne({
          _id: oid(sid),
          institutionId: topic.institutionId,
          courseId: topic.courseId,
          parentTopicId: parentId,
        })
        .lean<TopicDoc>();
      if (!s || String(s._id) === String(topic._id))
        throw new AppError('VALIDATION_FAILED', 'Neighbour must be a sibling at the destination', [
          { path, issue: 'invalid' },
        ]);
      return s;
    };
    const before = await sibling(input.beforeId, 'beforeId');
    const after = await sibling(input.afterId, 'afterId');
    let lo = before?.orderKey ?? null;
    let hi = after?.orderKey ?? null;
    if (!before && !after) lo = await this.lastKey(course, parentId);
    if (before && !after) {
      const next = await this.topics
        .findOne({
          institutionId: topic.institutionId,
          courseId: topic.courseId,
          parentTopicId: parentId,
          orderKey: { $gt: before.orderKey },
          _id: { $ne: topic._id },
        })
        .sort({ orderKey: 1 })
        .lean<TopicDoc>();
      hi = next?.orderKey ?? null;
    }
    if (after && !before) {
      const prev = await this.topics
        .findOne({
          institutionId: topic.institutionId,
          courseId: topic.courseId,
          parentTopicId: parentId,
          orderKey: { $lt: after.orderKey },
          _id: { $ne: topic._id },
        })
        .sort({ orderKey: -1 })
        .lean<TopicDoc>();
      lo = prev?.orderKey ?? null;
    }
    if (lo !== null && hi !== null && lo >= hi)
      throw new AppError('VALIDATION_FAILED', 'Neighbours are not adjacent', [
        { path: 'beforeId', issue: 'invalid' },
      ]);
    const orderKey = orderKeyBetween(lo, hi);
    const moved = await this.topics
      .findOneAndUpdate(
        { _id: topic._id, institutionId: topic.institutionId },
        { $set: { parentTopicId: parentId, depth: parentId ? 1 : 0, orderKey } },
        { returnDocument: 'after' },
      )
      .lean<TopicDoc>();
    await this.audit.record({
      actor,
      action: 'topic.move',
      target: { type: 'topic', id },
      institutionId: topic.institutionId,
      before: { parentTopicId: topic.parentTopicId, orderKey: topic.orderKey },
      after: { parentTopicId: parentId, orderKey },
    });
    return moved!;
  }

  /** Archiving a topic archives its subtopics. Nothing is deleted. */
  async archive(actor: Actor, scope: TenantScope, id: string): Promise<TopicDoc> {
    const t = await this.load(scope, id);
    const now = new Date();
    await this.topics.updateMany(
      { institutionId: t.institutionId, parentTopicId: t._id, archivedAt: null },
      { $set: { archivedAt: now } },
    );
    const after = await this.topics
      .findOneAndUpdate(
        { _id: t._id, institutionId: t.institutionId },
        { $set: { archivedAt: now } },
        { returnDocument: 'after' },
      )
      .lean<TopicDoc>();
    await this.audit.record({
      actor,
      action: 'topic.archive',
      target: { type: 'topic', id },
      institutionId: t.institutionId,
    });
    return after!;
  }
}

export function toTopicDto(t: TopicDoc): Topic {
  return {
    id: String(t._id),
    courseId: String(t.courseId),
    parentTopicId: t.parentTopicId ? String(t.parentTopicId) : null,
    title: t.title,
    slug: t.slug,
    orderKey: t.orderKey,
    depth: t.depth,
    learningObjectives: t.learningObjectives.map((o) => ({
      id: o.id,
      text: o.text,
      source: o.source,
    })),
    outlineNodeKey: t.outlineNodeKey ?? null,
    publication: {
      state: t.publication?.state ?? 'unpublished',
      publishedAt: t.publication?.publishedAt?.toISOString() ?? null,
    },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    archivedAt: t.archivedAt?.toISOString() ?? null,
  };
}
