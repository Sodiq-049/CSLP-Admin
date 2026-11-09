import { z } from 'zod';
import { ERROR_CODES } from '@cslp/shared-types';
import { responseContract } from './registry.js';

export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex id');
export type ObjectIdString = z.infer<typeof ObjectIdSchema>;

export const IsoDateSchema = z.string().datetime({ offset: true });

/** `?page=1&pageSize=25` — admin tables (docs/04 §2). */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const ResponseMetaSchema = responseContract(
  'ResponseMeta',
  z.object({
    requestId: z.string(),
    page: z.number().int().optional(),
    pageSize: z.number().int().optional(),
    total: z.number().int().optional(),
    nextCursor: z.string().nullable().optional(),
  }),
);
export type ResponseMeta = z.infer<typeof ResponseMetaSchema>;

export const ErrorCodeSchema = z.enum(Object.keys(ERROR_CODES) as [keyof typeof ERROR_CODES]);

export const ApiErrorSchema = responseContract(
  'ApiError',
  z.object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      details: z.array(z.object({ path: z.string(), issue: z.string() })).optional(),
      requestId: z.string(),
    }),
  }),
);
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const OkSchema = responseContract('Ok', z.object({ ok: z.literal(true) }));

/** Sub-document carried by every archivable entity. */
export const AuditStampsSchema = z.object({
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  archivedAt: IsoDateSchema.nullable(),
});

/** Letters/digits/space/&-'.,() — names of academic entities. */
export const EntityNameSchema = z.string().trim().min(2).max(200);
export const ShortCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, 'Letters, digits, spaces, "-" and "_" only');
