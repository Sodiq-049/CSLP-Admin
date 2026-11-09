import type { Request } from 'express';
import type { PageQuery } from '@cslp/validation';
import type { TenantScope } from '@cslp/server-core';
import type { AuthContext } from '../auth/auth.types.js';

/** Controllers return this for paginated lists; the envelope interceptor adds page meta. */
export class PageResult<T> {
  constructor(
    readonly items: T[],
    readonly total: number,
    readonly page: number,
    readonly pageSize: number,
  ) {}
  static of<S, T>(r: { items: S[]; total: number }, q: PageQuery, map: (s: S) => T): PageResult<T> {
    return new PageResult(r.items.map(map), r.total, q.page, q.pageSize);
  }
}

export interface AppRequest extends Request {
  id: string;
  auth?: AuthContext;
  tenantScope?: TenantScope;
  scopedInstitutionId?: string | null;
}
