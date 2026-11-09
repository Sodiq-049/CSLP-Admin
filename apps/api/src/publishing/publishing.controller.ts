import { Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  PublishedContentService,
  PublishingService,
  type Actor,
  type TenantScope,
} from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const material = { entity: 'material', param: 'id' } as const;

@ApiTags('admin: publishing')
@Controller('admin')
export class PublishingController {
  constructor(
    private readonly publishing: PublishingService,
    private readonly published: PublishedContentService,
  ) {}

  @Post('materials/:id/publish')
  @RequirePermission('content.publish', material)
  @ApiOk(V.PublicationStateSchema)
  publish(
    @IdParam() id: string,
    @ZodBody(V.PublishMaterialSchema) b: z.output<typeof V.PublishMaterialSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.publishing.publish(a, s, id, b.versionId);
  }

  @Post('materials/:id/schedule')
  @RequirePermission('content.schedule', material)
  @ApiOk(V.PublicationStateSchema)
  schedule(
    @IdParam() id: string,
    @ZodBody(V.ScheduleMaterialSchema) b: z.output<typeof V.ScheduleMaterialSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.publishing.schedule(a, s, id, b.versionId, new Date(b.publishAt));
  }

  @Post('materials/:id/cancel-schedule')
  @RequirePermission('content.schedule', material)
  @ApiOk(V.PublicationStateSchema)
  cancel(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.publishing.cancelSchedule(a, s, id);
  }

  @Post('materials/:id/unpublish')
  @RequirePermission('content.unpublish', material)
  @ApiOk(V.PublicationStateSchema)
  unpublish(
    @IdParam() id: string,
    @ZodBody(V.UnpublishSchema) b: z.output<typeof V.UnpublishSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.publishing.unpublish(a, s, id, b.reason);
  }

  @Post('materials/:id/rollback')
  @RequirePermission('content.rollback', material)
  @ApiOk(V.PublicationStateSchema)
  rollback(
    @IdParam() id: string,
    @ZodBody(V.RollbackSchema) b: z.output<typeof V.RollbackSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.publishing.rollback(a, s, id, b.toVersionId, b.reason);
  }

  @Post('courses/:id/publish')
  @RequirePermission('course.publish', { entity: 'course', param: 'id' })
  @ApiOk(V.PublicationStateSchema)
  publishCourse(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.publishing.setCourse(a, s, id, true);
  }

  @Post('courses/:id/unpublish')
  @RequirePermission('course.publish', { entity: 'course', param: 'id' })
  @ApiOk(V.PublicationStateSchema)
  unpublishCourse(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.publishing.setCourse(a, s, id, false);
  }

  @Post('topics/:id/publish')
  @RequirePermission('content.publish', { entity: 'topic', param: 'id' })
  @ApiOk(V.PublicationStateSchema)
  publishTopic(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.publishing.setTopic(a, s, id, true);
  }

  @Post('topics/:id/unpublish')
  @RequirePermission('content.unpublish', { entity: 'topic', param: 'id' })
  @ApiOk(V.PublicationStateSchema)
  unpublishTopic(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.publishing.setTopic(a, s, id, false);
  }

  @Post('publish-bundles')
  @RequirePermission('content.publish')
  @ApiOk(V.OkSchema)
  async bundle(
    @ZodBody(V.PublishBundleSchema) b: z.output<typeof V.PublishBundleSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    await this.publishing.bundle(a, s, b);
    return { ok: true as const };
  }

  @Get('publishing/overview')
  @RequirePermission('content.view')
  @ApiOk(V.PublishingOverviewSchema)
  overview(
    @ZodQuery(V.AiUsageQuerySchema.pick({ institutionId: true })) q: { institutionId?: string },
    @Scope() s: TenantScope,
  ) {
    return this.publishing.overview(s, q.institutionId);
  }

  @Get('publication-events')
  @RequirePermission('content.view')
  @ApiOk(V.PublicationEventSchema, { list: true })
  async events(
    @ZodQuery(V.PublicationEventQuerySchema) q: z.output<typeof V.PublicationEventQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.publishing.history(s, q);
    return new PageResult(r.items, r.total, q.page, q.pageSize);
  }

  @Get('versions/:id/preview-as-student')
  @RequirePermission('content.view', { entity: 'version', param: 'id' })
  @ApiOk(V.StudentMaterialSchema)
  preview(@IdParam() id: string, @Scope() s: TenantScope) {
    return this.published.preview(s, id);
  }
}
