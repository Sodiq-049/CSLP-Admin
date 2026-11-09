import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import { AppError } from '@cslp/server-core';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PageResult, type AppRequest } from './http.js';
import { RESPONSE_CONTRACT, type ResponseContractMeta } from './zod.js';

/** Wraps every success response as `{ data, meta }` (docs/04 §2). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EnvelopeInterceptor.name);
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    ctx
      .switchToHttp()
      .getResponse<{ setHeader(k: string, v: string): void }>()
      .setHeader('x-request-id', req.id);
    const contract = this.reflector.get<ResponseContractMeta | undefined>(
      RESPONSE_CONTRACT,
      ctx.getHandler(),
    );
    return next.handle().pipe(
      map((value: unknown) => {
        const meta: Record<string, unknown> = { requestId: req.id };
        let data: unknown = value;
        if (value instanceof PageResult) {
          data = value.items;
          Object.assign(meta, { page: value.page, pageSize: value.pageSize, total: value.total });
        }
        if (contract && this.config.VALIDATE_RESPONSES) {
          const schema = contract.list ? z.array(contract.schema) : contract.schema;
          const r = schema.safeParse(data);
          if (!r.success) {
            this.logger.error(
              { route: req.route?.path, issues: r.error.issues.slice(0, 10) },
              'Response contract violation',
            );
            throw new AppError('INTERNAL', 'Response contract violation');
          }
        }
        return { data: data ?? null, meta };
      }),
    );
  }
}
