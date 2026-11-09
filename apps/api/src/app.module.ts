import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ServerCoreModule, type CoreConfig } from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { AllExceptionsFilter } from './common/exception.filter.js';
import { EnvelopeInterceptor } from './common/envelope.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import { MailModule } from './mail/mail.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { PermissionsGuard } from './auth/permissions.guard.js';
import { AcademicModule } from './academic/academic.module.js';
import { AdminUsersModule } from './admin-users/admin-users.module.js';
import { ContentModule } from './courses/content.module.js';
import { HealthController } from './health/health.controller.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

@Module({})
export class AppModule {
  static register(config: AppConfig, core: CoreConfig = config.core): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            genReqId: (req: IncomingMessage) => {
              const incoming = req.headers['x-request-id'];
              return typeof incoming === 'string' && REQUEST_ID.test(incoming)
                ? incoming
                : `req_${randomUUID()}`;
            },
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            autoLogging: config.NODE_ENV !== 'test',
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
        }),
        MongooseModule.forRoot(config.MONGODB_URI, { autoIndex: true }),
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
          // Disabled in automated tests (account lockout is enforced separately and is tested).
          skipIf: () => config.NODE_ENV === 'test',
        }),
        ServerCoreModule.forRoot(core),
        MailModule,
        AuthModule,
        AcademicModule,
        AdminUsersModule,
        ContentModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        // Order matters: throttle → authenticate → authorise.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useExisting: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [APP_CONFIG],
    };
  }
}
