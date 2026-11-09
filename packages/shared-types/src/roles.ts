/**
 * Roles and permissions — single source of truth (docs/03-roles-permissions.md).
 * Controllers declare permissions, never role names.
 */
export const ROLES = [
  'super_admin',
  'institution_admin',
  'content_manager',
  'academic_reviewer',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  institution_admin: 'Institution Administrator',
  content_manager: 'Content Manager',
  academic_reviewer: 'Academic Reviewer',
};

export const PERMISSIONS = [
  // platform (super admin only, global)
  'platform.settings.manage',
  'platform.ai_providers.manage',
  'platform.billing.manage',
  'platform.analytics.view',
  'platform.security.manage',
  // institutions
  'institution.create',
  'institution.update',
  'institution.archive',
  'institution.view',
  // users
  'admin_user.invite',
  'admin_user.update',
  'admin_user.suspend',
  'role.assign.any',
  'role.assign.institution_staff',
  'student.view',
  'student.manage',
  // academic structure
  'academic.view',
  'academic.manage',
  // courses / topics / outlines / sources
  'course.view',
  'course.create',
  'course.update',
  'course.archive',
  'course.publish',
  'topic.manage',
  'outline.upload',
  'outline.approve',
  'source.upload',
  'source.approve_for_generation',
  'source.delete',
  // content
  'content.view',
  'content.generate',
  'content.edit',
  'content.submit_review',
  'content.review',
  'content.publish',
  'content.unpublish',
  'content.rollback',
  'content.schedule',
  // quizzes
  'quiz.manage',
  'question.review',
  'question.mark_official',
  // video
  'video.generate',
  'video.edit',
  'video.review',
  'video.publish',
  // ai ops
  'ai_jobs.view',
  'ai_jobs.cancel',
  'ai_usage.view',
  'ai_budget.manage',
  // governance
  'audit.view',
  'analytics.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that only make sense platform-wide; never granted through an institution-scoped assignment. */
export const GLOBAL_ONLY_PERMISSIONS: readonly Permission[] = [
  'platform.settings.manage',
  'platform.ai_providers.manage',
  'platform.billing.manage',
  'platform.analytics.view',
  'platform.security.manage',
  'institution.create',
  'institution.archive',
  'role.assign.any',
  'ai_budget.manage',
];

const CONTENT_MANAGER: readonly Permission[] = [
  'institution.view',
  'academic.view',
  'course.view',
  'course.create',
  'course.update',
  'topic.manage',
  'outline.upload',
  'source.upload',
  'content.view',
  'content.generate',
  'content.edit',
  'content.submit_review',
  'quiz.manage',
  'video.generate',
  'video.edit',
  'ai_jobs.view',
  'ai_jobs.cancel',
];

const ACADEMIC_REVIEWER: readonly Permission[] = [
  'institution.view',
  'academic.view',
  'course.view',
  'outline.approve',
  'source.approve_for_generation',
  'content.view',
  'content.review',
  'question.review',
  'question.mark_official',
  'video.review',
  'ai_jobs.view',
];

const INSTITUTION_ADMIN: readonly Permission[] = Array.from(
  new Set<Permission>([
    ...CONTENT_MANAGER,
    ...ACADEMIC_REVIEWER,
    'institution.update',
    'admin_user.invite',
    'admin_user.update',
    'admin_user.suspend',
    'role.assign.institution_staff',
    'student.view',
    'student.manage',
    'academic.manage',
    'course.archive',
    'course.publish',
    'source.delete',
    'content.publish',
    'content.unpublish',
    'content.rollback',
    'content.schedule',
    'video.publish',
    'ai_usage.view',
    'audit.view',
    'analytics.view',
  ]),
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  institution_admin: INSTITUTION_ADMIN,
  content_manager: CONTENT_MANAGER,
  academic_reviewer: ACADEMIC_REVIEWER,
};

/** Roles an institution admin may grant (role.assign.institution_staff). */
export const INSTITUTION_STAFF_ROLES: readonly Role[] = ['content_manager', 'academic_reviewer'];

/** Roles that must have MFA enabled before they can use the portal. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['super_admin', 'institution_admin'];

export const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  institution_admin: 50,
  content_manager: 10,
  academic_reviewer: 10,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
