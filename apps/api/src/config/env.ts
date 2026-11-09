import { z } from 'zod';
import { coreConfigFromEnv, type CoreConfig } from '@cslp/server-core';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    MONGODB_URI: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    MFA_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'MFA_ENCRYPTION_KEY must be 32 bytes, base64',
      ),
    ADMIN_APP_URL: z.string().url().default('http://localhost:3001'),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: z.string().optional(),
    VALIDATE_RESPONSES: bool.optional(),
    /** Force two-step verification on Super/Institution Administrators. Off: MFA is optional per user. */
    MFA_REQUIRED: bool.default(false),
    /** Where students land from email links (verification, password reset). */
    STUDENT_APP_URL: z.string().url().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: bool.optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('CSLP <no-reply@cslp.local>'),
    /** Comma-separated email domains allowed to self-register as students (empty = any). */
    STUDENT_EMAIL_DOMAINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .transform((e) => ({
    ...e,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
    // Response contract checks: on everywhere except production (docs/04 §1).
    VALIDATE_RESPONSES: e.VALIDATE_RESPONSES ?? e.NODE_ENV !== 'production',
    STUDENT_APP_URL: e.STUDENT_APP_URL ?? e.ADMIN_APP_URL,
    smtp: e.SMTP_HOST
      ? {
          host: e.SMTP_HOST,
          port: e.SMTP_PORT ?? 587,
          secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
          user: e.SMTP_USER,
          pass: e.SMTP_PASS,
        }
      : null,
  }));

export type AppConfig = z.infer<typeof EnvSchema> & { core: CoreConfig };
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = EnvSchema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const core = coreConfigFromEnv(env);
  if (
    r.data.NODE_ENV === 'production' &&
    (core.ai.textProvider === 'fake' || core.ai.embeddings.provider === 'fake')
  ) {
    throw new Error(
      'Invalid environment configuration:\n  - AI_TEXT_PROVIDER / AI_EMBEDDINGS_PROVIDER: "fake" is for development only',
    );
  }
  if (core.queue.mode === 'bullmq' && core.storage.driver === 'memory') {
    throw new Error(
      'Invalid environment configuration:\n  - S3_BUCKET: required when REDIS_URL is set (the worker cannot read in-memory uploads)',
    );
  }
  return { ...r.data, core };
}
