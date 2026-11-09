import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { createRedis } from './redis.js';
import type { JobType } from '@cslp/shared-types';
import { CORE_CONFIG, type CoreConfig } from '../config.js';

export const QUEUE_FOR: Record<JobType, string> = {
  document_ingest: 'cslp-documents',
  outline_extraction: 'cslp-ai-text',
  content_generation: 'cslp-ai-text',
  quiz_generation: 'cslp-ai-text',
};

export type JobHandler = (jobId: string, attempt: number) => Promise<void>;

/**
 * Enqueues background work. BullMQ in api/worker; `inline` runs handlers in-process (tests and
 * Redis-less development). Payloads carry only the job id: state lives in generationJobs.
 */
@Injectable()
export class JobQueue implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueue.name);
  private readonly queues = new Map<string, Queue>();
  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly pending = new Set<Promise<void>>();
  private redis: Redis | null = null;

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  get mode() {
    return this.config.queue.mode;
  }

  /** Inline mode only: register the processor that `enqueue` will call. */
  registerInlineHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  private queue(name: string): Queue {
    const q = this.config.queue;
    if (q.mode !== 'bullmq') throw new Error('BullMQ not configured');
    let queue = this.queues.get(name);
    if (!queue) {
      this.redis ??= createRedis(q.redisUrl);
      queue = new Queue(name, { connection: this.redis });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(type: JobType, jobId: string): Promise<void> {
    if (this.config.queue.mode === 'bullmq') {
      await this.queue(QUEUE_FOR[type]).add(
        type,
        { jobId },
        {
          jobId, // BullMQ refuses duplicate ids → no double processing
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 7 * 86400 },
          removeOnFail: { age: 30 * 86400 },
        },
      );
      return;
    }
    const handler = this.handlers.get(type);
    if (!handler) {
      this.logger.warn(`No inline handler for ${type}; job ${jobId} stays queued`);
      return;
    }
    const p = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => handler(jobId, 1))
      .catch((err) => this.logger.error({ err, jobId }, 'Inline job failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Tests: wait until all inline work (including jobs enqueued by jobs) has finished. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.redis?.quit().catch(() => undefined);
  }
}
