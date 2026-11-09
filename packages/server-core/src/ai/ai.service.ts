import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import OpenAI from 'openai';
import { Types, type Model } from 'mongoose';
import { z } from 'zod';
import { CORE_CONFIG, type CoreConfig } from '../config.js';
import { MODELS } from '../database/model-names.js';
import type { AiUsageDoc } from '../sources/source.schemas.js';

interface CallContext {
  institutionId: Types.ObjectId;
  jobId?: Types.ObjectId | null;
  taskKey: string;
}

/**
 * Provider access for text generation and embeddings (docs/06 §1). Business code passes task keys;
 * models come from CoreConfig. Every call is recorded in the usage ledger.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI | null;

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @InjectModel(MODELS.AiUsage) private readonly usage: Model<AiUsageDoc>,
  ) {
    this.openai = config.ai.openaiApiKey
      ? new OpenAI({ apiKey: config.ai.openaiApiKey, maxRetries: 2, timeout: 120_000 })
      : null;
  }

  /** Is a real text model configured for this task? Callers fall back to deterministic logic if not. */
  textAvailable(taskKey: string): boolean {
    return (
      this.config.ai.textProvider === 'openai' &&
      !!this.openai &&
      !!this.config.ai.textModels[taskKey]
    );
  }

  /** 'openai' (real), 'fake' (development placeholders) or 'none' for a task. */
  textMode(taskKey: string): 'openai' | 'fake' | 'none' {
    if (this.textAvailable(taskKey)) return 'openai';
    return this.config.ai.textProvider === 'fake' ? 'fake' : 'none';
  }

  modelFor(taskKey: string): string | null {
    const mode = this.textMode(taskKey);
    return mode === 'openai'
      ? this.config.ai.textModels[taskKey]!
      : mode === 'fake'
        ? 'fake-placeholder-v1'
        : null;
  }

  get embeddingModel(): string | null {
    const e = this.config.ai.embeddings;
    if (e.provider === 'none') return null;
    if (e.provider === 'openai' && !this.openai) return null;
    return e.model || null;
  }

  /** Structured output validated by Zod on the server; invalid output never reaches the database. */
  async generateStructured<T extends z.ZodType>(
    ctx: CallContext,
    req: { system: string; user: string; schema: T; schemaName: string },
  ): Promise<z.output<T>> {
    const model = this.config.ai.textModels[ctx.taskKey];
    if (!this.openai || !model) throw new Error(`No text model configured for ${ctx.taskKey}`);
    const { $schema: _s, ...jsonSchema } = z.toJSONSchema(req.schema, {
      io: 'output',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    const started = Date.now();
    try {
      const res = await this.openai.responses.create({
        model,
        input: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        text: {
          format: { type: 'json_schema', name: req.schemaName, schema: jsonSchema, strict: true },
        },
      });
      await this.record(ctx, 'text', 'openai', model, {
        requestId: res.id,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - started,
      });
      return req.schema.parse(JSON.parse(res.output_text));
    } catch (err) {
      await this.record(ctx, 'text', 'openai', model, {
        latencyMs: Date.now() - started,
        error: (err as Error).name,
      });
      throw err;
    }
  }

  async embed(ctx: CallContext, texts: string[]): Promise<{ vectors: number[][]; model: string }> {
    const e = this.config.ai.embeddings;
    const model = this.embeddingModel;
    if (!model) throw new Error('No embedding provider configured');
    if (e.provider === 'fake')
      return { vectors: texts.map((t) => fakeEmbedding(t, e.dimensions)), model };
    const started = Date.now();
    try {
      const res = await this.openai!.embeddings.create({
        model,
        input: texts,
        dimensions: e.dimensions,
      });
      await this.record(ctx, 'embedding', 'openai', model, {
        inputTokens: res.usage.prompt_tokens,
        latencyMs: Date.now() - started,
      });
      return { vectors: res.data.map((d) => d.embedding), model };
    } catch (err) {
      await this.record(ctx, 'embedding', 'openai', model, {
        latencyMs: Date.now() - started,
        error: (err as Error).name,
      });
      throw err;
    }
  }

  private async record(
    ctx: CallContext,
    capability: 'text' | 'embedding',
    provider: string,
    model: string,
    r: {
      requestId?: string;
      inputTokens?: number;
      outputTokens?: number;
      latencyMs: number;
      error?: string;
    },
  ) {
    try {
      await this.usage.create({
        institutionId: ctx.institutionId,
        jobId: ctx.jobId ?? null,
        capability,
        taskKey: ctx.taskKey,
        provider,
        model,
        providerRequestId: r.requestId ?? null,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        latencyMs: r.latencyMs,
        status: r.error ? 'error' : 'ok',
        errorCode: r.error ?? null,
      });
    } catch (err) {
      this.logger.error({ err }, 'Failed to record AI usage');
    }
  }
}

/** Deterministic, normalised pseudo-embedding for tests and offline development. Never mixed with real models (different model name). */
export function fakeEmbedding(text: string, dims: number): number[] {
  const out = new Array<number>(dims);
  let seed = createHash('sha256').update(text).digest();
  for (let i = 0; i < dims; i++) {
    if (i % 32 === 0 && i) seed = createHash('sha256').update(seed).digest();
    out[i] = seed[i % 32]! / 127.5 - 1;
  }
  const norm = Math.hypot(...out) || 1;
  return out.map((v) => v / norm);
}
