import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { isIP } from 'node:net';
import { safeEqual } from './auth/crypto.js';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.js';
import { buildOpenApiDocument } from './openapi/document.js';

/** HTTP-level configuration shared by main.ts, the OpenAPI emitter and e2e tests. */
export function configureApp(
  app: NestExpressApplication,
  config: AppConfig,
): NestExpressApplication {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  const secret = config.PROXY_SHARED_SECRET;
  if (secret) {
    // Requests relayed by the admin portal carry the visitor's IP, vouched for by a shared secret.
    app.use((req: { headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
      const given = req.headers['x-cslp-proxy-secret'];
      const ip = req.headers['x-cslp-client-ip'];
      if (
        typeof given === 'string' &&
        safeEqual(given, secret) &&
        typeof ip === 'string' &&
        isIP(ip)
      ) {
        Object.defineProperty(req, 'ip', { value: ip, configurable: true });
        Object.defineProperty(req, 'ips', { value: [ip], configurable: true });
      }
      delete req.headers['x-cslp-proxy-secret'];
      delete req.headers['x-cslp-client-ip'];
      next();
    });
  }
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
