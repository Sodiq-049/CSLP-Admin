import type { MeResponse } from '@cslp/api-client';
import type { Permission } from '@cslp/shared-types';

/** Mirrors the backend check for UI affordances only. The API always re-checks (docs/03 §4). */
export function can(
  me: MeResponse | undefined,
  permission: Permission,
  institutionId?: string | null,
): boolean {
  if (!me) return false;
  if (me.permissions.global.includes(permission)) return true;
  const by = me.permissions.byInstitution as Record<string, string[]>;
  if (institutionId) return by[institutionId]?.includes(permission) ?? false;
  return Object.values(by).some((list) => list.includes(permission));
}

export function isSuperAdmin(me: MeResponse | undefined): boolean {
  return !!me?.assignments.some((a) => a.role === 'super_admin');
}
