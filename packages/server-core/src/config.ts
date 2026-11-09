/**
 * Runtime configuration for the shared domain layer. apps/api and apps/worker build it from their
 * environment; tests build it directly. No secrets are hard-coded and no model names appear in
 * business logic (docs/06 §1). Models are chosen here by task key.
 */
export interface CoreConfig {
  storage:
    | { driver: 'memory' }
    | {
        driver: 's3';
        endpoint?: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
      };
  queue: { mode: 'inline' } | { mode: 'bullmq'; redisUrl: string };
  scanner: { driver: 'none' } | { driver: 'clamav'; host: string; port: number };
  ai: {
    openaiApiKey?: string;
    /** 'fake' = clearly-labelled deterministic placeholders for development; refused in production. */
    textProvider: 'openai' | 'fake' | 'none';
    /** task key → model, e.g. { 'outline.extract': '<model>' } */
    textModels: Record<string, string>;
    embeddings: { provider: 'openai' | 'fake' | 'none'; model: string; dimensions: number };
    /** USD per 1M tokens by model (AI_PRICES_JSON). Unknown models show tokens only, never a guessed cost. */
    prices: Record<string, { input: number; output: number }>;
  };
}

export const CORE_CONFIG = Symbol('CORE_CONFIG');

/** Parse the shared environment variables (used by api + worker). */
export function coreConfigFromEnv(env: NodeJS.ProcessEnv): CoreConfig {
  const s3 = env.S3_BUCKET
    ? ({
        driver: 's3',
        endpoint: env.S3_ENDPOINT || undefined,
        region: env.S3_REGION ?? 'auto',
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
        forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      } as const)
    : ({ driver: 'memory' } as const);
  const embeddingProvider = (env.AI_EMBEDDINGS_PROVIDER ??
    (env.OPENAI_API_KEY ? 'openai' : 'none')) as 'openai' | 'fake' | 'none';
  const textProvider = (env.AI_TEXT_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'none')) as
    'openai' | 'fake' | 'none';
  const notesModel = env.AI_MODEL_NOTES ?? '';
  return {
    storage: s3,
    queue:
      env.REDIS_URL && env.QUEUE_MODE !== 'inline'
        ? { mode: 'bullmq', redisUrl: env.REDIS_URL }
        : { mode: 'inline' },
    scanner: env.CLAMAV_HOST
      ? { driver: 'clamav', host: env.CLAMAV_HOST, port: Number(env.CLAMAV_PORT ?? 3310) }
      : { driver: 'none' },
    ai: {
      openaiApiKey: env.OPENAI_API_KEY || undefined,
      textProvider,
      textModels: {
        'outline.extract': env.AI_MODEL_OUTLINE_EXTRACT ?? '',
        'notes.comprehensive': notesModel,
        'notes.simplified': env.AI_MODEL_NOTES_SIMPLIFIED ?? notesModel,
        'revision.pack': env.AI_MODEL_REVISION ?? notesModel,
        'quiz.generate': env.AI_MODEL_QUIZ ?? notesModel,
        'editor.action': env.AI_MODEL_EDITOR ?? env.AI_MODEL_OUTLINE_EXTRACT ?? '',
      },
      prices: parsePrices(env.AI_PRICES_JSON),
      embeddings: {
        provider: embeddingProvider,
        // Fake vectors are always labelled as such so they can never mix with a real model's vectors.
        model: embeddingProvider === 'fake' ? 'fake-hash-v1' : (env.AI_EMBEDDINGS_MODEL ?? ''),
        dimensions: Number(env.AI_EMBEDDINGS_DIMENSIONS ?? 1536),
      },
    },
  };
}

function parsePrices(raw: string | undefined): Record<string, { input: number; output: number }> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, { input: number; output: number }>;
    return Object.fromEntries(
      Object.entries(v).filter(
        ([, p]) => typeof p?.input === 'number' && typeof p?.output === 'number',
      ),
    );
  } catch {
    throw new Error(
      'AI_PRICES_JSON must be JSON like {"model-id":{"input":1.25,"output":10}} (USD per 1M tokens)',
    );
  }
}
