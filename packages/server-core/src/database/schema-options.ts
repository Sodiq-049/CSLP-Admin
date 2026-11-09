import type { SchemaOptions } from 'mongoose';

export const baseSchemaOptions = {
  timestamps: true,
  versionKey: '__v',
  strict: 'throw',
} satisfies SchemaOptions;

export const archivableFields = {
  archivedAt: { type: Date, default: null },
};
