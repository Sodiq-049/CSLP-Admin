import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { CourseOutline, OutlineNode, TopicSyncPlan } from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import { JobsService } from '../jobs/jobs.service.js';
import { SourceDocumentsService, type UploadedFile } from '../sources/source-documents.service.js';
import type { CourseDoc, CourseOutlineDoc, OutlineNodeDoc, TopicDoc } from './course.schemas.js';
import { CoursesService } from './courses.service.js';
import { TopicsService } from './topics.service.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const toNodes = (nodes: OutlineNode[]): OutlineNodeDoc[] =>
  nodes.map((n) => ({
    key: n.key,
    title: n.title,
    sourceQuote: n.sourceQuote ?? null,
    confidence: n.confidence ?? null,
    children: (n.children ?? []).map((c) => ({
      key: c.key,
      title: c.title,
      sourceQuote: c.sourceQuote ?? null,
      confidence: c.confidence ?? null,
    })),
  }));

@Injectable()
export class OutlinesService {
  constructor(
    @InjectModel(MODELS.CourseOutline) private readonly outlines: Model<CourseOutlineDoc>,
    @InjectModel(MODELS.Course) private readonly courseModel: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topicModel: Model<TopicDoc>,
    private readonly courses: CoursesService,
    private readonly topics: TopicsService,
    private readonly sources: SourceDocumentsService,
    private readonly jobs: JobsService,
    private readonly audit: AuditLogService,
  ) {}

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const o = await this.outlines
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return o ? String(o.institutionId) : null;
  }

  async load(scope: TenantScope, id: string): Promise<CourseOutlineDoc> {
    const institutionId = await this.resolveInstitutionId(id);
    if (!institutionId) throw AppError.notFound('Outline');
    assertInstitutionAccess(scope, institutionId);
    const o = await this.outlines
      .findOne({ _id: oid(id), institutionId: oid(institutionId) })
      .lean<CourseOutlineDoc>();
    if (!o) throw AppError.notFound('Outline');
    return o;
  }

  async listForCourse(scope: TenantScope, courseId: string): Promise<CourseOutlineDoc[]> {
    const course = await this.courses.load(scope, courseId);
    return this.outlines
      .find({ institutionId: course.institutionId, courseId: course._id })
      .sort({ version: -1 })
      .lean<CourseOutlineDoc[]>();
  }

  /** Cross-course review list for the Course Outlines page. */
  async listDrafts(scope: TenantScope, institutionId?: string) {
    const items = await this.outlines
      .find({ ...institutionFilter(scope, institutionId), status: 'draft' })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean<CourseOutlineDoc[]>();
    const courses = await this.courseModel
      .find(
        {
          institutionId: { $in: [...new Set(items.map((o) => String(o.institutionId)))].map(oid) },
          _id: { $in: items.map((o) => o.courseId) },
        },
        { code: 1, title: 1 },
      )
      .lean<CourseDoc[]>();
    const byId = new Map(courses.map((c) => [String(c._id), c]));
    return items.map((o) => ({ outline: o, course: byId.get(String(o.courseId)) }));
  }

  private async nextVersion(course: CourseDoc): Promise<number> {
    const last = await this.outlines
      .findOne({ institutionId: course.institutionId, courseId: course._id }, { version: 1 })
      .sort({ version: -1 })
      .lean<{ version: number }>();
    return (last?.version ?? 0) + 1;
  }

  private async startExtraction(outline: CourseOutlineDoc, actor: Actor) {
    const { job } = await this.jobs.start({
      type: 'outline_extraction',
      institutionId: outline.institutionId,
      dedupeKey: `outline:${outline._id}`,
      target: {
        outlineId: outline._id,
        courseId: outline.courseId,
        sourceDocumentId: outline.sourceDocumentId,
      },
      requestedBy: actor.userId,
    });
    await this.outlines.updateOne(
      { _id: outline._id, institutionId: outline.institutionId },
      { $set: { 'extraction.jobId': job._id } },
    );
  }

  private async insert(
    actor: Actor,
    course: CourseDoc,
    fields: Partial<CourseOutlineDoc>,
  ): Promise<CourseOutlineDoc> {
    if (course.archivedAt) throw AppError.conflict('Archived courses cannot be edited');
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await this.outlines.create({
          institutionId: course.institutionId,
          courseId: course._id,
          version: await this.nextVersion(course),
          createdBy: actor.userId ? oid(actor.userId) : null,
          ...fields,
        });
        const obj = doc.toObject() as CourseOutlineDoc;
        await this.audit.record({
          actor,
          action: 'outline.create',
          target: { type: 'outline', id: obj._id },
          institutionId: course.institutionId,
          after: { courseId: course._id, version: obj.version, origin: obj.origin },
        });
        return obj;
      } catch (err) {
        if ((err as { code?: number }).code === 11000 && attempt < 3) continue; // concurrent version bump
        throw err;
      }
    }
  }

  async createFromPaste(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    text: string,
  ): Promise<CourseOutlineDoc> {
    const course = await this.courses.load(scope, courseId);
    const o = await this.insert(actor, course, {
      origin: 'paste',
      rawText: text,
      extraction: { status: 'pending' } as CourseOutlineDoc['extraction'],
    });
    await this.startExtraction(o, actor);
    return this.load(scope, String(o._id));
  }

  async createManual(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    structure: OutlineNode[],
  ): Promise<CourseOutlineDoc> {
    const course = await this.courses.load(scope, courseId);
    return this.insert(actor, course, { origin: 'manual', structure: toNodes(structure) });
  }

  /** The original file is kept as a course-outline source document (and is itself available for RAG). */
  async createFromUpload(
    actor: Actor,
    scope: TenantScope,
    courseId: string,
    file: UploadedFile,
  ): Promise<CourseOutlineDoc> {
    const course = await this.courses.load(scope, courseId);
    const { doc } = await this.sources.upload(
      actor,
      scope,
      String(course.institutionId),
      file,
      {
        title: `Course outline: ${course.code} (${file.originalName})`.slice(0, 300),
        category: 'course_outline',
        courseId: String(course._id),
        licenceType: 'institution_owned',
      },
      { allowExisting: true },
    );
    const o = await this.insert(actor, course, {
      origin: 'upload',
      sourceDocumentId: doc._id,
      extraction: { status: 'pending' } as CourseOutlineDoc['extraction'],
    });
    // If the text is already available (re-used file), analyse now; otherwise ingestion triggers it.
    if (doc.processing.status === 'ready') await this.startExtraction(o, actor);
    return this.load(scope, String(o._id));
  }

  async updateStructure(
    actor: Actor,
    scope: TenantScope,
    id: string,
    structure: OutlineNode[],
  ): Promise<CourseOutlineDoc> {
    const o = await this.load(scope, id);
    if (o.status !== 'draft')
      throw new AppError(
        'VERSION_FROZEN',
        'Approved outlines cannot be edited. Create a new version instead.',
      );
    const keys = structure.flatMap((n) => [n.key, ...(n.children ?? []).map((c) => c.key)]);
    if (new Set(keys).size !== keys.length)
      throw new AppError('VALIDATION_FAILED', 'Outline node keys must be unique', [
        { path: 'structure', issue: 'duplicate_key' },
      ]);
    const after = await this.outlines
      .findOneAndUpdate(
        { _id: o._id, institutionId: o.institutionId, status: 'draft' },
        { $set: { structure: toNodes(structure) } },
        { returnDocument: 'after' },
      )
      .lean<CourseOutlineDoc>();
    await this.audit.record({
      actor,
      action: 'outline.update',
      target: { type: 'outline', id },
      institutionId: o.institutionId,
    });
    return after!;
  }

  async approve(actor: Actor, scope: TenantScope, id: string): Promise<CourseOutlineDoc> {
    const o = await this.load(scope, id);
    if (o.status !== 'draft')
      throw new AppError('INVALID_TRANSITION', 'Only draft outlines can be approved');
    if (!o.structure.length)
      throw new AppError('VALIDATION_FAILED', 'Add at least one topic before approving', [
        { path: 'structure', issue: 'empty' },
      ]);
    await this.outlines.updateMany(
      { institutionId: o.institutionId, courseId: o.courseId, status: 'approved' },
      { $set: { status: 'superseded' } },
    );
    const after = await this.outlines
      .findOneAndUpdate(
        { _id: o._id, institutionId: o.institutionId, status: 'draft' },
        {
          $set: {
            status: 'approved',
            approvedBy: actor.userId ? oid(actor.userId) : null,
            approvedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .lean<CourseOutlineDoc>();
    await this.courseModel.updateOne(
      { _id: o.courseId, institutionId: o.institutionId },
      { $set: { activeOutlineId: o._id } },
    );
    await this.audit.record({
      actor,
      action: 'outline.approve',
      target: { type: 'outline', id },
      institutionId: o.institutionId,
      after: { version: o.version },
    });
    return after!;
  }

  /**
   * Compare the approved outline with the course's topics. Creates missing topics/subtopics in
   * outline order when `apply`; never deletes or renames existing topics (docs/02 §4).
   */
  async syncTopics(
    actor: Actor,
    scope: TenantScope,
    id: string,
    apply: boolean,
  ): Promise<TopicSyncPlan> {
    const o = await this.load(scope, id);
    if (o.status !== 'approved')
      throw new AppError('INVALID_TRANSITION', 'Approve the outline before syncing topics');
    const existing = await this.topicModel
      .find({ institutionId: o.institutionId, courseId: o.courseId, archivedAt: null })
      .sort({ orderKey: 1 })
      .lean<TopicDoc[]>();
    const tops = existing.filter((t) => !t.parentTopicId);
    const subsOf = (pid: Types.ObjectId) =>
      existing.filter((t) => String(t.parentTopicId) === String(pid));
    const plan: TopicSyncPlan = { applied: apply, create: [], matched: [], notInOutline: [] };
    const used = new Set<string>();
    const pending: {
      node: OutlineNodeDoc;
      parent: TopicDoc | null;
      parentNode: OutlineNodeDoc | null;
    }[] = [];

    for (const node of o.structure) {
      const match = tops.find(
        (t) => !used.has(String(t._id)) && norm(t.title) === norm(node.title),
      );
      if (match) {
        used.add(String(match._id));
        plan.matched.push({ key: node.key, title: node.title, topicId: String(match._id) });
        for (const child of node.children) {
          const sub = subsOf(match._id).find(
            (s) => !used.has(String(s._id)) && norm(s.title) === norm(child.title),
          );
          if (sub) {
            used.add(String(sub._id));
            plan.matched.push({ key: child.key, title: child.title, topicId: String(sub._id) });
          } else {
            plan.create.push({ key: child.key, title: child.title, parentTitle: node.title });
            pending.push({ node: child as OutlineNodeDoc, parent: match, parentNode: null });
          }
        }
      } else {
        plan.create.push({ key: node.key, title: node.title, parentTitle: null });
        pending.push({ node, parent: null, parentNode: null });
        for (const child of node.children) {
          plan.create.push({ key: child.key, title: child.title, parentTitle: node.title });
          pending.push({ node: child as OutlineNodeDoc, parent: null, parentNode: node });
        }
      }
    }
    plan.notInOutline = tops
      .filter((t) => !used.has(String(t._id)))
      .map((t) => ({ topicId: String(t._id), title: t.title }));
    if (!apply) return plan;

    const created = new Map<string, TopicDoc>();
    for (const p of pending) {
      const parentTopicId = p.parent
        ? String(p.parent._id)
        : p.parentNode
          ? String(created.get(p.parentNode.key)!._id)
          : undefined;
      const t = await this.topics.create(actor, scope, String(o.courseId), {
        title: p.node.title,
        parentTopicId,
        learningObjectives: [],
        outlineNodeKey: p.node.key,
      });
      created.set(p.node.key, t);
    }
    await this.audit.record({
      actor,
      action: 'outline.sync_topics',
      target: { type: 'outline', id },
      institutionId: o.institutionId,
      after: { created: plan.create.length },
    });
    return plan;
  }

  async documentUrl(scope: TenantScope, id: string) {
    const o = await this.load(scope, id);
    if (!o.sourceDocumentId) throw AppError.notFound('Original document');
    return this.sources.downloadUrl(scope, String(o.sourceDocumentId));
  }
}

export function toOutlineDto(o: CourseOutlineDoc): CourseOutline {
  const nodes = (list: OutlineNodeDoc[]) =>
    list.map((n) => ({
      key: n.key,
      title: n.title,
      sourceQuote: n.sourceQuote ?? null,
      confidence: n.confidence ?? null,
      children: (n.children ?? []).map((c) => ({
        key: c.key,
        title: c.title,
        sourceQuote: c.sourceQuote ?? null,
        confidence: c.confidence ?? null,
      })),
    }));
  return {
    id: String(o._id),
    courseId: String(o.courseId),
    version: o.version,
    origin: o.origin,
    sourceDocumentId: o.sourceDocumentId ? String(o.sourceDocumentId) : null,
    status: o.status,
    rawText: o.rawText ?? null,
    structure: nodes(o.structure),
    extraction: {
      status: o.extraction.status,
      method: o.extraction.method ?? null,
      suggestedStructure: nodes(o.extraction.suggestedStructure ?? []),
      detectedMetadata: o.extraction.detectedMetadata ?? null,
      warnings: o.extraction.warnings ?? [],
      error: o.extraction.error ?? null,
    },
    approvedBy: o.approvedBy ? String(o.approvedBy) : null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
