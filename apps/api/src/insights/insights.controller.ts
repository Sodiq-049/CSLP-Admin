import { Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import { InsightsService, type Actor, type TenantScope } from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

@ApiTags('admin: insights')
@Controller('admin')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Every admin role can see the overview for the institutions they work in. */
  @Get('dashboard/overview')
  @RequirePermission('course.view')
  @ApiOk(V.DashboardOverviewSchema)
  overview(@Scope() s: TenantScope) {
    return this.insights.overview(s);
  }

  @Get('analytics/engagement')
  @RequirePermission('analytics.view')
  @ApiOk(V.EngagementSchema)
  engagement(
    @ZodQuery(V.EngagementQuerySchema) q: z.output<typeof V.EngagementQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    return this.insights.engagement(s, q);
  }

  @Get('students')
  @RequirePermission('student.view')
  @ApiOk(V.StudentAccountSchema, { list: true })
  async students(
    @ZodQuery(V.StudentListQuerySchema) q: z.output<typeof V.StudentListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.insights.listStudents(s, q);
    return new PageResult(r.items, r.total, q.page, q.pageSize);
  }

  @Patch('students/:id/status')
  @RequirePermission('student.manage', { entity: 'student', param: 'id' })
  @ApiOk(V.StudentAccountSchema)
  setStatus(
    @IdParam() id: string,
    @ZodBody(V.StudentStatusSchema) body: z.output<typeof V.StudentStatusSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.insights.setStudentStatus(s, a, id, body.status, body.reason);
  }
}
