import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@cslp/shared-types';
import type { TenantScope } from '@cslp/server-core';
import type { AppRequest } from '../common/http.js';
import type { AuthContext } from './auth.types.js';

export const IS_PUBLIC = 'cslp:public';
export const ALLOW_WITHOUT_MFA = 'cslp:allow-without-mfa';
export const REQUIRE_PERMISSION = 'cslp:permission';
export const RECENT_AUTH = 'cslp:recent-auth';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is reachable by a session that still owes MFA (enrolment, me, logout). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

/** Requires the session to have authenticated within the last 10 minutes (docs/03 §5). */
export const RequireRecentAuth = () => SetMetadata(RECENT_AUTH, true);

/**
 * How the guard finds the institution a request targets (docs/03 §4.3):
 * - `institutionParam`: route param that *is* an institution id
 * - `entity` + `param`: route param holding an entity id, resolved through the ScopeResolverRegistry
 * - omitted: list/global route — services receive `perms.scopeFor(permission)`
 */
export type ScopeSpec = { institutionParam: string } | { entity: string; param: string };

export interface PermissionRequirement {
  permission: Permission;
  scope?: ScopeSpec;
}

export const RequirePermission = (permission: Permission, scope?: ScopeSpec) =>
  SetMetadata(REQUIRE_PERMISSION, { permission, scope } satisfies PermissionRequirement);

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    return req.auth!;
  },
);

/** The TenantScope computed by PermissionsGuard for this route's permission. */
export const Scope = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantScope => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return req.tenantScope ?? { kind: 'institutions', institutionIds: [] };
});

/** Actor for audit logs. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return {
    userId: req.auth?.userId ?? null,
    roles: req.auth?.roles ?? [],
    requestId: req.id,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
});
