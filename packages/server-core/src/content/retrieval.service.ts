import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { MODELS } from '../database/model-names.js';
import { AiService } from '../ai/ai.service.js';
import type { DocumentChunkDoc, SourceDocumentDoc } from '../sources/source.schemas.js';

export interface RetrievedPassage {
  label: string; // S1, S2, …
  chunkId: Types.ObjectId;
  sourceDocumentId: Types.ObjectId;
  sourceTitle: string;
  page: number | null;
  headingPath: string[];
  text: string;
  score: number;
}

const STOP = new Set(
  'a an and are as at be by for from has in is it of on or that the this to was were will with what which how why when'.split(
    ' ',
  ),
);
const terms = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

/**
 * Retrieval over **approved** sources only, always filtered by institution (docs/03 §4.6).
 * Vector search when embeddings exist (Atlas); keyword scoring otherwise (local/test, or when the
 * embedding provider is unavailable).
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  constructor(
    @InjectModel(MODELS.DocumentChunk) private readonly chunks: Model<DocumentChunkDoc>,
    @InjectModel(MODELS.SourceDocument) private readonly docs: Model<SourceDocumentDoc>,
    private readonly ai: AiService,
  ) {}

  async retrieve(input: {
    institutionId: Types.ObjectId;
    courseId: Types.ObjectId;
    query: string;
    k?: number;
    jobId?: Types.ObjectId;
  }): Promise<RetrievedPassage[]> {
    const k = input.k ?? 10;
    const sources = await this.docs
      .find(
        {
          institutionId: input.institutionId,
          approvedForGeneration: true,
          archivedAt: null,
          $or: [{ courseId: input.courseId }, { courseId: null }],
        },
        { title: 1 },
      )
      .lean<SourceDocumentDoc[]>();
    if (!sources.length) return [];
    const titles = new Map(sources.map((s) => [String(s._id), s.title]));
    const sourceIds = sources.map((s) => s._id);

    let hits: (DocumentChunkDoc & { score: number })[] = [];
    const model = this.ai.embeddingModel;
    if (model) {
      try {
        const { vectors } = await this.ai.embed(
          { institutionId: input.institutionId, jobId: input.jobId, taskKey: 'embeddings.query' },
          [input.query],
        );
        hits = await this.chunks.aggregate([
          {
            $vectorSearch: {
              index: 'chunks_vector',
              path: 'embedding',
              queryVector: vectors[0]!,
              numCandidates: k * 15,
              limit: k * 2,
              filter: {
                institutionId: input.institutionId,
                embeddingModel: model,
                sourceDocumentId: { $in: sourceIds },
              },
            },
          },
          { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } },
        ]);
      } catch (err) {
        this.logger.debug(
          `Vector search unavailable, using keyword retrieval: ${(err as Error).message}`,
        );
        hits = [];
      }
    }
    if (!hits.length) hits = await this.keyword(input.institutionId, sourceIds, input.query, k * 2);

    // Diversify: at most 4 passages per source document.
    const perSource = new Map<string, number>();
    const picked = hits
      .filter((h) => {
        const n = perSource.get(String(h.sourceDocumentId)) ?? 0;
        if (n >= 4) return false;
        perSource.set(String(h.sourceDocumentId), n + 1);
        return true;
      })
      .slice(0, k);
    return picked.map((h, i) => ({
      label: `S${i + 1}`,
      chunkId: h._id,
      sourceDocumentId: h.sourceDocumentId,
      sourceTitle: titles.get(String(h.sourceDocumentId)) ?? 'Source',
      page: h.location?.page ?? null,
      headingPath: h.location?.headingPath ?? [],
      text: h.text,
      score: h.score,
    }));
  }

  private async keyword(
    institutionId: Types.ObjectId,
    sourceIds: Types.ObjectId[],
    query: string,
    limit: number,
  ) {
    const q = [...new Set(terms(query))];
    const candidates = await this.chunks
      .find({ institutionId, sourceDocumentId: { $in: sourceIds } })
      .limit(3000)
      .lean<DocumentChunkDoc[]>();
    return candidates
      .map((c) => {
        const t = c.text.toLowerCase();
        const heading = (c.location?.headingPath ?? []).join(' ').toLowerCase();
        const score =
          q.reduce(
            (s, term) => s + (t.includes(term) ? 1 : 0) + (heading.includes(term) ? 2 : 0),
            0,
          ) / Math.max(1, q.length);
        return { ...c, score };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
