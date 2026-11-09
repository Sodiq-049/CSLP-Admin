import { z } from 'zod';

/**
 * Contract registries. Every schema that crosses the API boundary is registered here with a
 * stable id; apps/api turns both registries into OpenAPI components:
 *  - requests  → JSON Schema of the *input* type (defaults optional)
 *  - responses → JSON Schema of the *output* type
 */
export interface ContractMeta {
  id: string;
  description?: string;
}
export const requestRegistry = z.registry<ContractMeta>();
export const responseRegistry = z.registry<ContractMeta>();

export function requestContract<T extends z.ZodType>(
  id: string,
  schema: T,
  description?: string,
): T {
  requestRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}

export function responseContract<T extends z.ZodType>(
  id: string,
  schema: T,
  description?: string,
): T {
  responseRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}
