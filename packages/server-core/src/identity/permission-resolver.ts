import {
  GLOBAL_ONLY_PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@cslp/shared-types';
import type { TenantScope } from '../tenancy/tenant-scope.js';

export interface AssignmentLike {
  role: Role;
  institutionId: string | null;
}

/** Effective permissions of a user, computed from active role assignments (docs/03 §1). */
export class EffectivePermissions {
  private constructor(
    readonly global: ReadonlySet<Permission>,
    readonly byInstitution: ReadonlyMap<string, ReadonlySet<Permission>>,
  ) {}

  static fromAssignments(assignments: readonly AssignmentLike[]): EffectivePermissions {
    const global = new Set<Permission>();
    const byInstitution = new Map<string, Set<Permission>>();
    for (const a of assignments) {
      const perms = ROLE_PERMISSIONS[a.role];
      if (a.institutionId === null) {
        perms.forEach((p) => global.add(p));
        continue;
      }
      const set = byInstitution.get(a.institutionId) ?? new Set<Permission>();
      for (const p of perms) if (!GLOBAL_ONLY_PERMISSIONS.includes(p)) set.add(p);
      byInstitution.set(a.institutionId, set);
    }
    return new EffectivePermissions(global, byInstitution);
  }

  /** True if the permission is held anywhere (fast pre-check before scope resolution). */
  hasAnywhere(permission: Permission): boolean {
    if (this.global.has(permission)) return true;
    for (const set of this.byInstitution.values()) if (set.has(permission)) return true;
    return false;
  }

  /** True if the permission is held for this institution (or globally). */
  can(permission: Permission, institutionId?: string | null): boolean {
    if (this.global.has(permission)) return true;
    if (!institutionId) return false;
    return this.byInstitution.get(institutionId)?.has(permission) ?? false;
  }

  /** The institutions on which `permission` may be exercised. */
  scopeFor(permission: Permission): TenantScope {
    if (this.global.has(permission)) return { kind: 'all' };
    const ids: string[] = [];
    for (const [id, set] of this.byInstitution) if (set.has(permission)) ids.push(id);
    return { kind: 'institutions', institutionIds: ids };
  }

  toJSON(): { global: Permission[]; byInstitution: Record<string, Permission[]> } {
    return {
      global: [...this.global].sort(),
      byInstitution: Object.fromEntries(
        [...this.byInstitution].map(([id, set]) => [id, [...set].sort()]),
      ),
    };
  }
}
