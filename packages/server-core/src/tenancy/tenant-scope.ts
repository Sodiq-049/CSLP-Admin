import { Types } from 'mongoose';
import { AppError } from '../errors/app-error.js';

/**
 * The set of institutions a caller may act on for a given permission (docs/03 §4.4).
 * Built by apps/api from role assignments; passed explicitly into every domain service call.
 */
export type TenantScope =
  { kind: 'all' } | { kind: 'institutions'; institutionIds: readonly string[] };

export const ALL_INSTITUTIONS: TenantScope = { kind: 'all' };

export function canAccessInstitution(
  scope: TenantScope,
  institutionId: string | Types.ObjectId,
): boolean {
  if (scope.kind === 'all') return true;
  return scope.institutionIds.includes(String(institutionId));
}

export function assertInstitutionAccess(
  scope: TenantScope,
  institutionId: string | Types.ObjectId,
): void {
  // Respond 404 rather than 403 so callers can't probe for other tenants' ids.
  if (!canAccessInstitution(scope, institutionId)) throw AppError.notFound('Institution');
}

/** Mongo filter fragment for list queries. Intersects an optional client-supplied filter. */
export function institutionFilter(
  scope: TenantScope,
  requested?: string,
): { institutionId: Types.ObjectId | { $in: Types.ObjectId[] } } {
  if (requested) {
    assertInstitutionAccess(scope, requested);
    return { institutionId: new Types.ObjectId(requested) };
  }
  if (scope.kind === 'all') {
    // Explicit "any institution" filter keeps the tenant plugin satisfied.
    return { institutionId: { $exists: true } as unknown as { $in: Types.ObjectId[] } };
  }
  return { institutionId: { $in: scope.institutionIds.map((id) => new Types.ObjectId(id)) } };
}
