import type { Institution, MeResponse } from '@cslp/api-client';
import { INSTITUTION_STAFF_ROLES, ROLE_LABELS, ROLES, type Role } from '@cslp/shared-types';
import { can } from '@/lib/permissions';

/** Roles the current admin may grant (mirrors docs/03 §3; the API enforces it). */
export function grantableRoles(me: MeResponse): Role[] {
  if (can(me, 'role.assign.any')) return [...ROLES];
  if (can(me, 'role.assign.institution_staff')) return [...INSTITUTION_STAFF_ROLES];
  return [];
}

export function grantableInstitutions(
  me: MeResponse,
  institutions: Institution[],
  role: Role | undefined,
): Institution[] {
  if (!role || role === 'super_admin') return [];
  if (can(me, 'role.assign.any')) return institutions;
  return institutions.filter((i) => can(me, 'role.assign.institution_staff', i.id));
}

export const roleOptions = (roles: Role[]) =>
  roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
export const ROLE_TONE: Record<Role, 'violet' | 'primary' | 'info' | 'warning'> = {
  super_admin: 'violet',
  institution_admin: 'primary',
  content_manager: 'info',
  academic_reviewer: 'warning',
};
