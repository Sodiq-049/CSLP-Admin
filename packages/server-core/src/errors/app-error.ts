import { ERROR_CODES, type ErrorCode } from '@cslp/shared-types';

export interface ErrorDetail {
  path: string;
  issue: string;
}

/** Transport-agnostic domain error. apps/api maps it to the error envelope (docs/04 §2). */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_CODES[code];
  }

  static notFound(what = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }
  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static conflict(message: string, details?: ErrorDetail[]): AppError {
    return new AppError('CONFLICT', message, details);
  }
}

/** Mongo duplicate-key error → field names. */
export function duplicateKeyFields(err: unknown): string[] | null {
  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    const kv = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    return Object.keys(kv);
  }
  return null;
}
