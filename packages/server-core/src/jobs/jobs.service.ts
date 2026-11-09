import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { JobType } from '@cslp/shared-types';
import type { GenerationJob } from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { duplicateKeyFields } from '../errors/app-error.js';
import type { GenerationJobDoc } from '../sources/source.schemas.js';
import { JobQueue } from './job-queue.js';

/** Errors a processor throws to say "don't retry, this input will never work". */
export class PermanentJobError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export type ProgressFn = (pct: number, stage: string, message?: string) => Promise<void>;

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  constructor(
    @InjectModel(MODELS.GenerationJob) private readonly jobs: Model<GenerationJobDoc>,
    private readonly queue: JobQueue,
  ) {}

  /**
   * Create + enqueue, deduplicated: if an active job with the same key exists it is returned instead
   * (docs/06 §7). Returns `{ job, deduplicated }`.
   */
  async start(input: {
    type: JobType;
    institutionId: Types.ObjectId | string;
    dedupeKey: string;
    target: Partial<GenerationJobDoc['target']>;
    input?: Record<string, unknown>;
    requestedBy?: string | null;
  }): Promise<{ job: GenerationJobDoc; deduplicated: boolean }> {
    const institutionId = new Types.ObjectId(String(input.institutionId));
    try {
      const job = (
        await this.jobs.create({
          institutionId,
          type: input.type,
          dedupeKey: input.dedupeKey,
          target: { sourceDocumentId: null, outlineId: null, courseId: null, ...input.target },
          input: input.input ?? {},
          requestedBy: input.requestedBy ? new Types.ObjectId(input.requestedBy) : null,
        })
      ).toObject() as GenerationJobDoc;
      await this.queue.enqueue(input.type, String(job._id));
      return { job, deduplicated: false };
    } catch (err) {
      if (!duplicateKeyFields(err)) throw err;
      const existing = await this.jobs
        .findOne({
          institutionId,
          dedupeKey: input.dedupeKey,
          status: { $in: ['queued', 'active'] },
        })
        .lean<GenerationJobDoc>();
      if (!existing) throw err;
      return { job: existing, deduplicated: true };
    }
  }

  /**
   * Run a processor for a job with status bookkeeping. Used by the BullMQ worker and inline mode.
   * `attempt` is 1-based; on a retryable failure with attempts left the job goes back to 'queued'
   * and the error is re-thrown so BullMQ schedules the retry.
   */
  async run(
    jobId: string,
    attempt: number,
    processor: (job: GenerationJobDoc, progress: ProgressFn) => Promise<void>,
  ): Promise<void> {
    const job = await this.jobs
      .findOneAndUpdate(
        { _id: new Types.ObjectId(jobId), status: { $in: ['queued', 'active'] } },
        {
          $set: { status: 'active', startedAt: new Date(), 'progress.stage': 'starting' },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' },
      )
      .setOptions({ crossTenant: true })
      .lean<GenerationJobDoc>();
    if (!job) {
      this.logger.warn({ jobId }, 'Job not runnable (cancelled or already finished)');
      return;
    }
    const scope = { _id: job._id, institutionId: job.institutionId };
    const progress: ProgressFn = async (pct, stage, message) => {
      await this.jobs.updateOne(scope, {
        $set: { progress: { pct, stage, message: message ?? null } },
      });
    };
    try {
      await processor(job, progress);
      await this.jobs.updateOne(scope, {
        $set: {
          status: 'completed',
          finishedAt: new Date(),
          // Keep any summary message the processor reported (e.g. "Created 6 questions").
          'progress.pct': 100,
          'progress.stage': 'done',
          lastError: null,
        },
      });
    } catch (err) {
      const permanent = err instanceof PermanentJobError;
      const message = err instanceof Error ? err.message : String(err);
      const willRetry = !permanent && this.queue.mode === 'bullmq' && attempt < job.maxAttempts;
      await this.jobs.updateOne(scope, {
        $set: {
          status: willRetry ? 'queued' : 'failed',
          lastError: {
            code: permanent ? (err as PermanentJobError).code : 'PROCESSING_ERROR',
            message,
            retryable: !permanent,
          },
          ...(willRetry ? {} : { finishedAt: new Date() }),
        },
      });
      this.logger.error({ err, jobId, attempt, willRetry }, 'Job failed');
      if (willRetry) throw err;
      throw new JobFailedError(message, permanent);
    }
  }

  async get(institutionId: Types.ObjectId, jobId: string): Promise<GenerationJobDoc | null> {
    return this.jobs
      .findOne({ _id: new Types.ObjectId(jobId), institutionId })
      .lean<GenerationJobDoc>();
  }

  async resolveInstitutionId(id: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const j = await this.jobs
      .findOne({ _id: new Types.ObjectId(id) }, { institutionId: 1 })
      .setOptions({ crossTenant: true })
      .lean<{ institutionId: Types.ObjectId }>();
    return j ? String(j.institutionId) : null;
  }

  async listForTargets(
    institutionId: Types.ObjectId,
    filter: Partial<Record<'sourceDocumentId' | 'outlineId' | 'courseId', Types.ObjectId>>,
  ) {
    const q: Record<string, unknown> = { institutionId };
    for (const [k, v] of Object.entries(filter)) q[`target.${k}`] = v;
    return this.jobs.find(q).sort({ createdAt: -1 }).limit(20).lean<GenerationJobDoc[]>();
  }
}

/** Final failure (no more retries). Processors have already recorded user-facing state. */
export class JobFailedError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = 'JobFailedError';
  }
}

export const toJobDto = (j: GenerationJobDoc): GenerationJob => ({
  id: String(j._id),
  type: j.type,
  status: j.status,
  progress: { pct: j.progress.pct, stage: j.progress.stage, message: j.progress.message ?? null },
  attempts: j.attempts,
  error: j.lastError?.message ?? null,
  target: {
    sourceDocumentId: j.target.sourceDocumentId ? String(j.target.sourceDocumentId) : null,
    outlineId: j.target.outlineId ? String(j.target.outlineId) : null,
    courseId: j.target.courseId ? String(j.target.courseId) : null,
  },
  createdAt: j.createdAt.toISOString(),
  finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
});
