import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  AdminUserListQuerySchema,
  AdminUserSchema,
  AssignRoleRequestSchema,
  InviteAdminRequestSchema,
  OkSchema,
} from '@cslp/validation';
import type { Actor } from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  CurrentActor,
  CurrentAuth,
  RequirePermission,
  RequireRecentAuth,
} from '../auth/decorators.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('admin: administrators')
@Controller('admin/admin-users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @RequirePermission('admin_user.update')
  @ApiOk(AdminUserSchema, { list: true })
  async list(
    @ZodQuery(AdminUserListQuerySchema) q: z.output<typeof AdminUserListQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    const r = await this.service.list(auth, q);
    return new PageResult(r.items, r.total, q.page, q.pageSize);
  }

  @Get(':id')
  @RequirePermission('admin_user.update')
  @ApiOk(AdminUserSchema)
  get(@IdParam() id: string, @CurrentAuth() auth: AuthContext) {
    return this.service.get(auth, id);
  }

  @Post()
  @RequirePermission('admin_user.invite')
  @RequireRecentAuth()
  @ApiOk(AdminUserSchema, { status: 201 })
  invite(
    @ZodBody(InviteAdminRequestSchema) body: z.output<typeof InviteAdminRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentActor() actor: Actor,
  ) {
    return this.service.invite(auth, actor, body);
  }

  @Post(':id/roles')
  @RequirePermission('admin_user.update')
  @RequireRecentAuth()
  @ApiOk(AdminUserSchema, { status: 201 })
  assignRole(
    @IdParam() id: string,
    @ZodBody(AssignRoleRequestSchema) body: z.output<typeof AssignRoleRequestSchema>,
    @CurrentAuth() auth: AuthContext,
    @CurrentActor() actor: Actor,
  ) {
    return this.service.assignRole(auth, actor, id, body);
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermission('admin_user.update')
  @RequireRecentAuth()
  @ApiOk(OkSchema)
  async revokeRole(
    @IdParam() id: string,
    @IdParam('assignmentId') assignmentId: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentActor() actor: Actor,
  ) {
    await this.service.revokeRole(auth, actor, id, assignmentId);
    return { ok: true as const };
  }

  @Post(':id/suspend')
  @RequirePermission('admin_user.suspend')
  @RequireRecentAuth()
  @ApiOk(AdminUserSchema)
  suspend(@IdParam() id: string, @CurrentAuth() auth: AuthContext, @CurrentActor() actor: Actor) {
    return this.service.setSuspended(auth, actor, id, true);
  }

  @Post(':id/reactivate')
  @RequirePermission('admin_user.suspend')
  @RequireRecentAuth()
  @ApiOk(AdminUserSchema)
  reactivate(
    @IdParam() id: string,
    @CurrentAuth() auth: AuthContext,
    @CurrentActor() actor: Actor,
  ) {
    return this.service.setSuspended(auth, actor, id, false);
  }
}
