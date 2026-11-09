import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MODELS } from '../database/model-names.js';
import { ObjectStorage } from '../storage/object-storage.js';
import { AiService } from '../ai/ai.service.js';
import { JobsService, PermanentJobError, type ProgressFn } from '../jobs/jobs.service.js';
import type {
  DocumentChunkDoc,
  GenerationJobDoc,
  MediaAssetDoc,
  SourceDocumentDoc,
} from '../sources/source.schemas.js';
import type { CourseOutlineDoc } from '../courses/course.schemas.js';
import { sniffDocument } from './file-type.js';
import { blocksToText, extractDocument } from './extract-text.js';
import { chunkBlocks } from './chunker.js';

const EMBED_BATCH = 64;

/** document_ingest: extract → chunk → embed → hand off waiting outlines (docs/06 §2). */
@Injectable()
export class IngestionProcessor {
  private readonly logger = new Logger(IngestionProcessor.name);
  constructor(
    @InjectModel(MODELS.SourceDocument) private readonly docs: Model<SourceDocumentDoc>,
    @InjectModel(MODELS.DocumentChunk) private readonly chunks: Model<DocumentChunkDoc>,
    @InjectModel(MODELS.MediaAsset) private readonly assets: Model<MediaAssetDoc>,
    @InjectModel(MODELS.CourseOutline) private readonly outlines: Model<CourseOutlineDoc>,
    private readonly storage: ObjectStorage,
    private readonly ai: AiService,
    private readonly jobs: JobsService,
  ) {}

  handle = (jobId: string, attempt: number) =>
    this.jobs.run(jobId, attempt, (job, progress) => this.process(job, progress));

  private async process(job: GenerationJobDoc, progress: ProgressFn): Promise<void> {
    const scope = { _id: job.target.sourceDocumentId!, institutionId: job.institutionId };
    const doc = await this.docs.findOne(scope).lean<SourceDocumentDoc>();
    if (!doc || doc.archivedAt)
      throw new PermanentJobError('NOT_FOUND', 'Source document no longer exists');
    const setStatus = (
      status: SourceDocumentDoc['processing']['status'],
      extra: Record<string, unknown> = {},
    ) => this.docs.updateOne(scope, { $set: { 'processing.status': status, ...extra } });

    try {
      await setStatus('extracting', { 'processing.error': null, 'processing.warnings': [] });
      await progress(10, 'extracting');
      const asset = await this.assets
        .findOne({ _id: doc.assetId, institutionId: doc.institutionId })
        .lean<MediaAssetDoc>();
      if (!asset) throw new PermanentJobError('NOT_FOUND', 'Stored file is missing');
      const bytes = await this.storage.get(asset.storageKey);
      const type = sniffDocument(bytes);
      if (!type) throw new PermanentJobError('UNSUPPORTED_FILE', 'Unsupported file type');
      const extracted = await extractDocument(bytes, type.kind);
      const text = blocksToText(extracted.blocks);
      if (text.replace(/\s/g, '').length < 20) {
        throw new PermanentJobError(
          'NO_TEXT',
          'No readable text was found. Scanned PDFs need OCR, which is not enabled yet.',
        );
      }
      const textKey = asset.storageKey.replace(/\.\w+$/, '.extracted.txt');
      await this.storage.put(textKey, Buffer.from(text, 'utf8'), 'text/plain; charset=utf-8');

      await setStatus('chunking', {
        extractedTextKey: textKey,
        pageCount: extracted.pageCount,
        'processing.warnings': extracted.warnings,
      });
      await progress(40, 'chunking');
      const pieces = chunkBlocks(extracted.blocks);
      await this.chunks.deleteMany({ institutionId: doc.institutionId, sourceDocumentId: doc._id });
      await this.chunks.insertMany(
        pieces.map((c) => ({
          institutionId: doc.institutionId,
          courseId: doc.courseId,
          sourceDocumentId: doc._id,
          ordinal: c.ordinal,
          text: c.text,
          tokenCount: c.tokenCount,
          location: {
            page: c.page,
            headingPath: c.headingPath,
            charStart: c.charStart,
            charEnd: c.charEnd,
          },
          embedding: null,
          embeddingModel: null,
        })),
      );

      let model = this.ai.embeddingModel;
      const warnings = [...extracted.warnings];
      if (model) {
        await setStatus('embedding', { 'processing.chunkCount': pieces.length });
        try {
          for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
            const batch = pieces.slice(i, i + EMBED_BATCH);
            const { vectors } = await this.ai.embed(
              { institutionId: doc.institutionId, jobId: job._id, taskKey: 'embeddings.default' },
              batch.map((c) => c.text),
            );
            await this.chunks.bulkWrite(
              batch.map((c, j) => ({
                updateOne: {
                  filter: {
                    institutionId: doc.institutionId,
                    sourceDocumentId: doc._id,
                    ordinal: c.ordinal,
                  },
                  update: { $set: { embedding: vectors[j], embeddingModel: model } },
                },
              })),
            );
            await progress(50 + Math.round((45 * (i + batch.length)) / pieces.length), 'embedding');
          }
        } catch (err) {
          // The text is still usable (keyword retrieval); embeddings can be added later by reprocessing.
          this.logger.warn(
            { err, sourceDocumentId: String(doc._id) },
            'Embedding failed; continuing without vectors',
          );
          await this.chunks.updateMany(
            { institutionId: doc.institutionId, sourceDocumentId: doc._id },
            { $set: { embedding: null, embeddingModel: null } },
          );
          warnings.push(
            `Embeddings could not be created (${(err as Error).message.slice(0, 160)}). Keyword search still works; reprocess later to add them.`,
          );
          model = null;
        }
      } else {
        warnings.push(
          'Embeddings were skipped: no embedding provider is configured. Search-based generation will need them later.',
        );
      }
      await setStatus('ready', {
        'processing.chunkCount': pieces.length,
        'processing.embedded': !!model,
        'processing.embeddingModel': model,
        'processing.warnings': warnings,
      });

      // Outlines waiting for this document's text can now be analysed.
      const waiting = await this.outlines
        .find(
          {
            institutionId: doc.institutionId,
            sourceDocumentId: doc._id,
            'extraction.status': 'pending',
          },
          { _id: 1, courseId: 1 },
        )
        .lean();
      for (const o of waiting) {
        const { job: oj } = await this.jobs.start({
          type: 'outline_extraction',
          institutionId: doc.institutionId,
          dedupeKey: `outline:${o._id}`,
          target: { outlineId: o._id, courseId: o.courseId, sourceDocumentId: doc._id },
          requestedBy: job.requestedBy ? String(job.requestedBy) : null,
        });
        await this.outlines.updateOne(
          { _id: o._id, institutionId: doc.institutionId },
          { $set: { 'extraction.jobId': oj._id } },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Processing failed';
      await setStatus('failed', { 'processing.error': message });
      await this.outlines.updateMany(
        {
          institutionId: doc.institutionId,
          sourceDocumentId: doc._id,
          'extraction.status': 'pending',
        },
        { $set: { 'extraction.status': 'failed', 'extraction.error': message } },
      );
      throw err;
    }
  }
}
