import {
  applyDecorators,
  Body,
  HttpCode,
  Param,
  Query,
  SetMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { requestRegistry, responseRegistry, ObjectIdSchema } from '@cslp/validation';
import { AppError } from '@cslp/server-core';

export const RESPONSE_CONTRACT = 'cslp:response-contract';
export interface ResponseContractMeta {
  schema: z.ZodType;
  list: boolean;
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

function inlineJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return rest;
}

function requestSchemaObject(schema: z.ZodType) {
  const id = requestRegistry.get(schema)?.id;
  return id ? ref(id) : inlineJsonSchema(schema, 'input');
}

function responseSchemaObject(schema: z.ZodType) {
  const id = responseRegistry.get(schema)?.id;
  return id ? ref(id) : inlineJsonSchema(schema, 'output');
}

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown) {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        r.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', issue: i.message })),
      );
    }
    return r.data;
  }
}

/** `@ZodBody(Schema) body` — validates and documents the request body in one place. */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    const descriptor = Object.getOwnPropertyDescriptor(target, key!)!;
    ApiBody({ schema: requestSchemaObject(schema) as never })(target, key!, descriptor);
  };
}

/** `@ZodQuery(Schema) query` — validates query string; documents each property as a parameter. */
export function ZodQuery(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
    const descriptor = Object.getOwnPropertyDescriptor(target, key!)!;
    const json = inlineJsonSchema(schema, 'input') as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop as never })(
        target,
        key!,
        descriptor,
      );
    }
  };
}

class ObjectIdPipe implements PipeTransform {
  constructor(private readonly name: string) {}
  transform(value: unknown) {
    if (!ObjectIdSchema.safeParse(value).success) throw AppError.notFound();
    return value;
  }
}

/** Route param that must be an ObjectId (malformed ids → 404). */
export function IdParam(name = 'id'): ParameterDecorator {
  return (target, key, index) => {
    Param(name, new ObjectIdPipe(name))(target, key, index);
    const descriptor = Object.getOwnPropertyDescriptor(target, key!)!;
    ApiParam({ name, schema: { type: 'string', pattern: '^[a-f\\d]{24}$' } })(
      target,
      key!,
      descriptor,
    );
  };
}

/** Documents (and in non-production, verifies) the response body inside the envelope. */
export function ApiOk(schema: z.ZodType, opts: { status?: number; list?: boolean } = {}) {
  const status = opts.status ?? 200;
  const list = opts.list ?? false;
  const data = responseSchemaObject(schema);
  return applyDecorators(
    SetMetadata(RESPONSE_CONTRACT, { schema, list } satisfies ResponseContractMeta),
    HttpCode(status),
    ApiResponse({
      status,
      description: 'Success',
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: list ? { type: 'array', items: data } : data,
          meta: ref('ResponseMeta'),
        },
      } as never,
    }),
  );
}
