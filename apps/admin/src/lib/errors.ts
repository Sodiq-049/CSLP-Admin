import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiClientError } from '@cslp/api-client';

export function errorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof ApiClientError) {
    if (err.status >= 500) return `${fallback} (ref ${err.body.requestId || 'n/a'})`;
    return err.message;
  }
  return fallback;
}

export function hasCode(err: unknown, code: string): boolean {
  return err instanceof ApiClientError && err.code === code;
}

/** Copy server field errors onto a react-hook-form instance; returns true if any were applied. */
export function applyFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): boolean {
  if (!(err instanceof ApiClientError)) return false;
  const fields = err.fieldErrors();
  const entries = Object.entries(fields).filter(([path]) => path !== '(root)');
  for (const [path, message] of entries) setError(path as Path<T>, { type: 'server', message });
  return entries.length > 0;
}
