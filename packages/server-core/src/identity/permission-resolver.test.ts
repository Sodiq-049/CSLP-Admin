import { describe, expect, it } from 'vitest';
import { EffectivePermissions } from './permission-resolver.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

describe('EffectivePermissions', () => {
  it('super admin is global', () => {
    const p = EffectivePermissions.fromAssignments([{ role: 'super_admin', institutionId: null }]);
    expect(p.can('institution.create')).toBe(true);
    expect(p.can('content.publish', A)).toBe(true);
    expect(p.scopeFor('course.view')).toEqual({ kind: 'all' });
  });

  it('permissions are evaluated per institution', () => {
    const p = EffectivePermissions.fromAssignments([
      { role: 'content_manager', institutionId: A },
      { role: 'academic_reviewer', institutionId: B },
    ]);
    expect(p.can('content.edit', A)).toBe(true);
    expect(p.can('content.edit', B)).toBe(false);
    expect(p.can('content.review', B)).toBe(true);
    expect(p.can('content.review', A)).toBe(false);
    expect(p.can('content.edit')).toBe(false); // no institution → no grant
    expect(p.scopeFor('content.edit')).toEqual({ kind: 'institutions', institutionIds: [A] });
    expect(p.hasAnywhere('content.review')).toBe(true);
  });

  it('institution admin never gets global-only permissions', () => {
    const p = EffectivePermissions.fromAssignments([
      { role: 'institution_admin', institutionId: A },
    ]);
    expect(p.can('institution.create', A)).toBe(false);
    expect(p.can('ai_budget.manage', A)).toBe(false);
    expect(p.can('academic.manage', A)).toBe(true);
  });
});
