import { describe, expect, it } from 'vitest';
import {
  GLOBAL_ONLY_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  roleHasPermission,
} from './roles.js';

describe('role permission matrix (docs/03)', () => {
  it('super admin has every permission', () => {
    expect([...ROLE_PERMISSIONS.super_admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('no institution-scoped role holds a global-only permission', () => {
    for (const role of ['institution_admin', 'content_manager', 'academic_reviewer'] as const) {
      for (const p of GLOBAL_ONLY_PERMISSIONS) expect(roleHasPermission(role, p)).toBe(false);
    }
  });

  it('content managers cannot review or publish', () => {
    for (const p of [
      'content.review',
      'content.publish',
      'video.publish',
      'course.publish',
    ] as const)
      expect(roleHasPermission('content_manager', p)).toBe(false);
  });

  it('reviewers can approve but not publish or author', () => {
    expect(roleHasPermission('academic_reviewer', 'content.review')).toBe(true);
    for (const p of ['content.publish', 'content.edit', 'content.generate'] as const)
      expect(roleHasPermission('academic_reviewer', p)).toBe(false);
  });

  it('institution admins can publish and manage academic structure', () => {
    for (const p of [
      'content.publish',
      'academic.manage',
      'role.assign.institution_staff',
    ] as const)
      expect(roleHasPermission('institution_admin', p)).toBe(true);
  });
});
