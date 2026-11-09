import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { AppError } from '@cslp/server-core';
import type { AppRequest } from '../common/http.js';
import { IS_PUBLIC, REQUIRE_PERMISSION, type PermissionRequirement } from './decorators.js';
import { ScopeResolverRegistry } from './scope-resolver.registry.js';

/**
 * Global permission + institution-scope guard (docs/03 §4 steps 2–4).
 * Fails closed: an /admin route without @RequirePermission is rejected.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolvers: ScopeResolverRegistry,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      REQUIRE_PERMISSION,
      targets,
    );
    const isAdminRoute = (req.baseUrl + req.path).startsWith('/api/v1/admin');
    if (!requirement) {
      if (isAdminRoute) throw new AppError('FORBIDDEN', 'Route has no permission declared');
      return true;
    }

    const auth = req.auth!;
    const { permission, scope } = requirement;
    if (!auth.permissions.hasAnywhere(permission)) throw AppError.forbidden();

    req.tenantScope = auth.permissions.scopeFor(permission);
    if (!scope) return true;

    let institutionId: string | null;
    if ('institutionParam' in scope) {
      const raw = req.params[scope.institutionParam];
      institutionId = typeof raw === 'string' && Types.ObjectId.isValid(raw) ? raw : null;
    } else {
      const raw = req.params[scope.param];
      institutionId =
        typeof raw === 'string' && Types.ObjectId.isValid(raw)
          ? await this.resolvers.resolve(scope.entity, raw)
          : null;
    }
    if (!institutionId) throw AppError.notFound();

    if (!auth.permissions.can(permission, institutionId)) {
      // Related to the institution but lacking the permission → 403; unrelated → 404 (no probing).
      const related =
        auth.permissions.global.size > 0 || auth.permissions.byInstitution.has(institutionId);
      throw related ? AppError.forbidden() : AppError.notFound();
    }
    req.scopedInstitutionId = institutionId;
    return true;
  }
}
