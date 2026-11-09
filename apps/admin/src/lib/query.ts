import type { QueryClient } from '@tanstack/react-query';

/** Generated query keys start with the request path, so prefix invalidation is reliable. */
export function invalidateAdmin(qc: QueryClient, prefix = '/api/v1/admin') {
  return qc.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith(prefix),
  });
}

export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : '—';
