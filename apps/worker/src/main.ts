import 'reflect-metadata';
import { Logger as NestLogger, Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Connection } from 'mongoose';
import { Logger, LoggerModule } from 'nestjs-pino';
import { z } from 'zod';
import {
  coreConfigFromEnv,
  GenerationProcessor,
  PublishingService,
  QuizGenerationProcessor,
  createRedis,
  IngestionProcessor,
  JobFailedError,
  OutlineExtractionProcessor,
  QUEUE_FOR,
  ServerCoreModule,
  type CoreConfig,
} from '@cslp/server-core';

/**
 * Background worker (docs/01 §4): consumes BullMQ queues and runs the shared processors from
 * @cslp/server-core. Scale horizontally; each job is idempotent and keyed by its id.
 */
const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required for the worker'),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  })
  .parse(process.env);
const core: CoreConfig = coreConfigFromEnv(process.env);
if (core.storage.driver === 'memory') {
  throw new Error(
    'The worker needs shared object storage: set S3_BUCKET/S3_ENDPOINT (memory storage is per-process).',
  );
}

@Module({})
class WorkerModule {
  static register(): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
        }),
        MongooseModule.forRoot(env.MONGODB_URI, { autoIndex: true }),
        ServerCoreModule.forRoot(core),
      ],
    };
  }
}

const app = await NestFactory.createApplicationContext(WorkerModule.register(), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
const log = new NestLogger('Worker');

/** Atlas Vector Search index for retrieval (docs/02 §7). Skipped where unsupported. */
async function ensureVectorIndex() {
  const e = core.ai.embeddings;
  if (e.provider === 'none') return;
  const coll = app.get<Connection>(getConnectionToken()).collection('documentchunks');
  try {
    const existing = await coll.listSearchIndexes('chunks_vector').toArray();
    if (existing.length) return;
    await coll.createSearchIndex({
      name: 'chunks_vector',
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: e.dimensions, similarity: 'cosine' },
          { type: 'filter', path: 'institutionId' },
          { type: 'filter', path: 'courseId' },
          { type: 'filter', path: 'sourceDocumentId' },
          { type: 'filter', path: 'embeddingModel' },
        ],
      },
    });
    log.log(`Created vector index chunks_vector (${e.dimensions} dimensions)`);
  } catch (err) {
    log.warn(`Vector index not created: ${(err as Error).message}`);
  }
}
await ensureVectorIndex();

const connection = createRedis(env.REDIS_URL);
const run =
  (handler: (jobId: string, attempt: number) => Promise<void>) =>
  async (job: Job<{ jobId: string }>) => {
    try {
      await handler(job.data.jobId, job.attemptsMade + 1);
    } catch (err) {
      // Final failures (permanent, or out of attempts) must not be retried again by BullMQ.
      if (err instanceof JobFailedError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };

const workers = [
  new Worker(QUEUE_FOR.document_ingest, run(app.get(IngestionProcessor).handle), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  }),
  // One queue carries several AI job types; dispatch on the BullMQ job name (= job type).
  new Worker(
    QUEUE_FOR.outline_extraction,
    (job: Job<{ jobId: string }>) =>
      run(
        job.name === 'content_generation'
          ? app.get(GenerationProcessor).handle
          : job.name === 'quiz_generation'
            ? app.get(QuizGenerationProcessor).handle
            : app.get(OutlineExtractionProcessor).handle,
      )(job),
    { connection, concurrency: env.WORKER_CONCURRENCY },
  ),
];
for (const w of workers) {
  w.on('failed', (job, err) => log.warn(`${w.name} job ${job?.id} failed: ${err.message}`));
  w.on('error', (err) => log.error(`${w.name} error: ${err.message}`));
}
log.log(
  `Listening on ${workers.map((w) => w.name).join(', ')} (concurrency ${env.WORKER_CONCURRENCY})`,
);

// Scheduled publishing sweep (docs/05 §5): every minute, one worker at a time (Redis lock).
const sweep = setInterval(async () => {
  try {
    const locked = await connection.set(
      'cslp:scheduler-lock',
      String(process.pid),
      'PX',
      55_000,
      'NX',
    );
    if (!locked) return;
    const n = await app.get(PublishingService).runDueSchedules();
    if (n) log.log(`Published ${n} scheduled item${n === 1 ? '' : 's'}`);
  } catch (err) {
    log.error(`Scheduled publishing sweep failed: ${(err as Error).message}`);
  }
}, 60_000);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.log(`${signal} received: finishing current jobs…`);
  clearInterval(sweep);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit().catch(() => undefined);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
