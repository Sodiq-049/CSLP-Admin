import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.js';
import { buildOpenApiDocument } from './openapi/document.js';

/** HTTP-level configuration shared by main.ts, the OpenAPI emitter and e2e tests. */
export function configureApp(
  app: NestExpressApplication,
  config: AppConfig,
): NestExpressApplication {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'content-type',
      'x-csrf-token',
      'x-request-id',
      'authorization',
      'idempotency-key',
      'if-match',
      'x-auth-mode',
    ],
    exposedHeaders: ['x-request-id', 'etag'],
  });
  app.enableShutdownHooks();
  if (config.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
      jsonDocumentUrl: 'api/v1/openapi.json',
    });
  }
  return app;
}

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
  });
  return configureApp(app, config);
}
