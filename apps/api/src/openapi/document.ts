import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';
import { requestRegistry, responseRegistry } from '@cslp/validation';

const uri = (id: string) => `#/components/schemas/${id}`;

function stripIds(schemas: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(schemas, (k, v) => (k === '$id' || k === '$schema' ? undefined : v)),
  );
}

/**
 * OpenAPI document = routes discovered by @nestjs/swagger + component schemas generated from
 * the Zod contract registries in @cslp/validation (docs/04 §1).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CSLP API')
    .setDescription('Shared API for the Admin Portal, Student Website and Mobile App.')
    .setVersion('1.0.0')
    .addCookieAuth('cslp_at')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  const req = z.toJSONSchema(requestRegistry, {
    target: 'openapi-3.0',
    io: 'input',
    uri,
    unrepresentable: 'any',
  });
  const res = z.toJSONSchema(responseRegistry, {
    target: 'openapi-3.0',
    io: 'output',
    uri,
    unrepresentable: 'any',
  });
  doc.components = doc.components ?? {};
  doc.components.schemas = {
    ...(doc.components.schemas ?? {}),
    ...(stripIds(req.schemas) as Record<string, never>),
    ...(stripIds(res.schemas) as Record<string, never>),
  };

  for (const path of Object.values(doc.paths)) {
    for (const op of Object.values(path) as { responses?: Record<string, unknown> }[]) {
      if (!op || typeof op !== 'object' || !('responses' in op)) continue;
      op.responses = op.responses ?? {};
      op.responses.default ??= {
        description: 'Error',
        content: { 'application/json': { schema: { $ref: uri('ApiError') } } },
      };
    }
  }
  return doc;
}
