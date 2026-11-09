import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ErrorCode } from '@cslp/shared-types';
import { AppError, type ErrorDetail } from '@cslp/server-core';
import type { AppRequest } from './http.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_FILE',
  429: 'RATE_LIMITED',
};

/** Every error leaves the API in the same envelope; 5xx never leak internals (docs/04 §2). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();

    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let message = 'Internal server error';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = status >= 500 ? message : exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests, please slow down';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      if (status < 500) message = status === 404 ? 'Route not found' : exception.message;
    }

    if (status >= 500) this.logger.error({ err: exception, requestId: req.id }, 'Unhandled error');

    if (req.id) res.setHeader('x-request-id', req.id);
    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}), requestId: req.id },
    });
  }
}
