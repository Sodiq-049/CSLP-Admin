import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { z } from 'zod';
import type { SourceCategory, LicenceType } from '@cslp/shared-types';
import type { SourceDocument, SourceListQuerySchema } from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import {
  assertInstitutionAccess,
  institutionFilter,
  type TenantScope,
} from '../tenancy/tenant-scope.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { MalwareScanner } from '../storage/malware-scanner.js';
import { JobsService } from '../jobs/jobs.service.js';
import { EXTENSION, MAX_UPLOAD_BYTES, sniffDocument } from '../ingest/file-type.js';
import type { CourseDoc } from '../courses/course.schemas.js';
import type { InstitutionDoc } from '../academic/academic.schemas.js';
import type { DocumentChunkDoc, MediaAssetDoc, SourceDocumentDoc } from './source.schemas.js';

const oid = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
}
export interface SourceMetadata {
  title: string;
  category: SourceCategory;
  courseId?: string;
  authors?: string;
  publisher?: string;
  year?: number;
  licenceType: LicenceType;
  licenceNotes?: string;
}

@Injectable()
export class SourceDocumentsService {
  constructor(
    @InjectModel(MODELS.SourceDocument) private readonly docs: Model<SourceDocumentDoc>,
    @InjectModel(MODELS.DocumentChunk) private readonly chunkModel: Model<DocumentChunkDoc>,
    @InjectModel(MODELS.MediaAsset) private readonly assets: Model<MediaAssetDoc>,
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    private readonly storage: ObjectStorage,
    private readonly scanner: MalwareScanner,
    private readonly jobs: JobsService,
    private readonly audit: AuditLogService,
  ) {}

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const d = await this.docs
      .findOne({ _id: oid(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return d ? String(d.institutionId) : null;
  }

  async load(scope: TenantScope, id: string): Promise<SourceDocumentDoc> {
    const institutionId = await this.resolveInstitutionId(id);
    if (!institutionId) throw AppError.notFound('Source document');
    assertInstitutionAccess(scope, institutionId);
    const d = await this.docs
      .findOne({ _id: oid(id), institutionId: oid(institutionId), archivedAt: null })
      .lean<SourceDocumentDoc>();
    if (!d) throw AppError.notFound('Source document');
    return d;
  }

  /**
   * Validate → scan → store → record → start ingestion (docs/06 §2).
   * `allowExisting` returns an identical already-uploaded document instead of rejecting it
   * (used when re-uploading the same outline file for a new outline version).
   */
  async upload(
    actor: Actor,
    scope: TenantScope,
    institutionId: string,
    file: UploadedFile,
    meta: SourceMetadata,
    opts: { allowExisting?: boolean } = {},
  ): Promise<{ doc: SourceDocumentDoc; existing: boolean }> {
    assertInstitutionAccess(scope, institutionId);
    const inst = await this.institutions.exists({ _id: oid(institutionId), archivedAt: null });
    if (!inst) throw AppError.notFound('Institution');
    if (file.buffer.length === 0)
      throw new AppError('VALIDATION_FAILED', 'The file is empty', [
        { path: 'file', issue: 'empty' },
      ]);
    if (file.buffer.length > MAX_UPLOAD_BYTES)
      throw new AppError('FILE_TOO_LARGE', 'Files must be 50 MB or smaller');
    const type = sniffDocument(file.buffer);
    if (!type)
      throw new AppError(
        'UNSUPPORTED_FILE',
        'Only PDF, Word (.docx) and plain-text files are accepted',
      );

    let courseId: Types.ObjectId | null = null;
    if (meta.courseId) {
      const course = await this.courses
        .findOne({ _id: oid(meta.courseId), institutionId: oid(institutionId) }, { _id: 1 })
        .lean();
      if (!course)
        throw new AppError('VALIDATION_FAILED', 'Course not found in this institution', [
          { path: 'courseId', issue: 'not_found' },
        ]);
      courseId = course._id;
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.docs
      .findOne({ institutionId: oid(institutionId), sha256, archivedAt: null })
      .lean<SourceDocumentDoc>();
    if (duplicate) {
      if (opts.allowExisting) return { doc: duplicate, existing: true };
      throw AppError.conflict(`This file was already uploaded as “${duplicate.title}”`, [
        { path: 'file', issue: 'duplicate' },
      ]);
    }

    const scanStatus = await this.scanner.scan(file.buffer);
    if (scanStatus === 'infected') {
      await this.audit.record({
        actor,
        action: 'source.rejected_malware',
        target: { type: 'upload', id: null },
        institutionId,
        after: { name: file.originalName, sha256 },
      });
      throw new AppError('UNSUPPORTED_FILE', 'The file was rejected by the malware scanner');
    }

    const storageKey = `institutions/${institutionId}/sources/${randomUUID()}.${EXTENSION[type.kind]}`;
    await this.storage.put(storageKey, file.buffer, type.mimeType);
    const asset = await this.assets.create({
      institutionId: oid(institutionId),
      storageKey,
      bucket: this.storage.bucket,
      originalName: file.originalName.slice(0, 255),
      mimeType: type.mimeType,
      sizeBytes: file.buffer.length,
      sha256,
      kind: 'document',
      scanStatus,
      createdBy: actor.userId ? oid(actor.userId) : null,
    });
    const doc = (
      await this.docs.create({
        institutionId: oid(institutionId),
        courseId,
        title: meta.title,
        authors: meta.authors
          ? meta.authors
              .split(/[;,]/)
              .map((a) => a.trim())
              .filter(Boolean)
          : [],
        publisher: meta.publisher ?? null,
        year: meta.year ?? null,
        category: meta.category,
        licence: {
          type: meta.licenceType,
          notes: meta.licenceNotes ?? null,
          confirmedBy: actor.userId ? oid(actor.userId) : null,
          confirmedAt: new Date(),
        },
        assetId: asset._id,
        mimeType: type.mimeType,
        sizeBytes: file.buffer.length,
        sha256,
        createdBy: actor.userId ? oid(actor.userId) : null,
      })
    ).toObject() as SourceDocumentDoc;
    await this.audit.record({
      actor,
      action: 'source.upload',
      target: { type: 'source_document', id: doc._id },
      institutionId,
      after: { title: doc.title, category: doc.category, licence: doc.licence.type },
    });
    await this.startIngest(doc, actor.userId);
    return {
      doc: (await this.docs
        .findOne({ _id: doc._id, institutionId: doc.institutionId })
        .lean<SourceDocumentDoc>())!,
      existing: false,
    };
  }

  private async startIngest(doc: SourceDocumentDoc, requestedBy: string | null) {
    const { job } = await this.jobs.start({
      type: 'document_ingest',
      institutionId: doc.institutionId,
      dedupeKey: `ingest:${doc._id}`,
      target: { sourceDocumentId: doc._id, courseId: doc.courseId },
      requestedBy,
    });
    await this.docs.updateOne(
      { _id: doc._id, institutionId: doc.institutionId },
      { $set: { 'processing.jobId': job._id } },
    );
  }

  async reprocess(actor: Actor, scope: TenantScope, id: string): Promise<SourceDocumentDoc> {
    const doc = await this.load(scope, id);
    if (!['failed', 'ready'].includes(doc.processing.status))
      throw AppError.conflict('This document is still being processed');
    await this.docs.updateOne(
      { _id: doc._id, institutionId: doc.institutionId },
      { $set: { 'processing.status': 'uploaded', 'processing.error': null } },
    );
    await this.startIngest(doc, actor.userId);
    await this.audit.record({
      actor,
      action: 'source.reprocess',
      target: { type: 'source_document', id },
      institutionId: doc.institutionId,
    });
    return this.load(scope, id);
  }

  async list(scope: TenantScope, q: z.output<typeof SourceListQuerySchema>) {
    const f: Record<string, unknown> = {
      ...institutionFilter(scope, q.institutionId),
      archivedAt: null,
    };
    if (q.courseId) f.courseId = oid(q.courseId);
    if (q.category) f.category = q.category;
    if (q.status) f['processing.status'] = q.status;
    if (q.q) f.title = new RegExp(escapeRegex(q.q), 'i');
    const [items, total] = await Promise.all([
      this.docs
        .find(f)
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean<SourceDocumentDoc[]>(),
      this.docs.countDocuments(f),
    ]);
    return { items, total };
  }

  async chunks(scope: TenantScope, id: string, page: number, pageSize: number) {
    const doc = await this.load(scope, id);
    const f = { institutionId: doc.institutionId, sourceDocumentId: doc._id };
    const [items, total] = await Promise.all([
      this.chunkModel
        .find(f)
        .sort({ ordinal: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<DocumentChunkDoc[]>(),
      this.chunkModel.countDocuments(f),
    ]);
    return { items, total };
  }

  async downloadUrl(scope: TenantScope, id: string) {
    const doc = await this.load(scope, id);
    const asset = await this.assets
      .findOne({ _id: doc.assetId, institutionId: doc.institutionId })
      .lean<MediaAssetDoc>();
    if (!asset) throw AppError.notFound('File');
    return this.storage.signedUrl(asset.storageKey, asset.originalName);
  }

  async setApproval(
    actor: Actor,
    scope: TenantScope,
    id: string,
    approved: boolean,
  ): Promise<SourceDocumentDoc> {
    const doc = await this.load(scope, id);
    if (approved && doc.processing.status !== 'ready')
      throw AppError.conflict('Only fully processed documents can be approved for AI generation');
    await this.docs.updateOne(
      { _id: doc._id, institutionId: doc.institutionId },
      {
        $set: {
          approvedForGeneration: approved,
          approvedBy: approved && actor.userId ? oid(actor.userId) : null,
          approvedAt: approved ? new Date() : null,
        },
      },
    );
    await this.audit.record({
      actor,
      action: approved ? 'source.approve' : 'source.unapprove',
      target: { type: 'source_document', id },
      institutionId: doc.institutionId,
    });
    return this.load(scope, id);
  }

  /** Soft-delete the record, remove its chunks and the stored file. */
  async remove(actor: Actor, scope: TenantScope, id: string): Promise<void> {
    const doc = await this.load(scope, id);
    await this.docs.updateOne(
      { _id: doc._id, institutionId: doc.institutionId },
      { $set: { archivedAt: new Date(), approvedForGeneration: false } },
    );
    await this.chunkModel.deleteMany({
      institutionId: doc.institutionId,
      sourceDocumentId: doc._id,
    });
    const asset = await this.assets
      .findOne({ _id: doc.assetId, institutionId: doc.institutionId })
      .lean<MediaAssetDoc>();
    if (asset) await this.storage.delete(asset.storageKey).catch(() => undefined);
    if (doc.extractedTextKey)
      await this.storage.delete(doc.extractedTextKey).catch(() => undefined);
    await this.audit.record({
      actor,
      action: 'source.delete',
      target: { type: 'source_document', id },
      institutionId: doc.institutionId,
      before: { title: doc.title },
    });
  }

  async fileInfo(docs: SourceDocumentDoc[]) {
    const assets = await this.assets
      .find({
        institutionId: { $in: [...new Set(docs.map((d) => String(d.institutionId)))].map(oid) },
        _id: { $in: docs.map((d) => d.assetId) },
      })
      .lean<MediaAssetDoc[]>();
    return new Map(assets.map((a) => [String(a._id), a]));
  }

  async toDtos(docs: SourceDocumentDoc[]): Promise<SourceDocument[]> {
    const assets = await this.fileInfo(docs);
    return docs.map((d) => {
      const a = assets.get(String(d.assetId));
      return {
        id: String(d._id),
        institutionId: String(d.institutionId),
        courseId: d.courseId ? String(d.courseId) : null,
        title: d.title,
        authors: d.authors,
        publisher: d.publisher ?? null,
        year: d.year ?? null,
        category: d.category,
        licence: {
          type: d.licence.type,
          notes: d.licence.notes ?? null,
          confirmedAt: d.licence.confirmedAt.toISOString(),
        },
        file: {
          name: a?.originalName ?? 'file',
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          pageCount: d.pageCount ?? null,
        },
        processing: {
          status: d.processing.status,
          chunkCount: d.processing.chunkCount,
          embedded: d.processing.embedded,
          error: d.processing.error ?? null,
          warnings: d.processing.warnings ?? [],
        },
        scanStatus: a?.scanStatus ?? 'pending',
        approvedForGeneration: d.approvedForGeneration,
        approvedAt: d.approvedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      };
    });
  }
}

export const toChunkDto = (c: DocumentChunkDoc) => ({
  id: String(c._id),
  ordinal: c.ordinal,
  text: c.text,
  tokenCount: c.tokenCount,
  page: c.location?.page ?? null,
  headingPath: c.location?.headingPath ?? [],
  embedded: !!c.embeddingModel,
});
