import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import { ContentService, type Actor, type TenantScope } from '@cslp/server-core';
import { ApiOk, IdParam, ZodBody } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const version = { entity: 'version', param: 'id' } as const;

@ApiTags('admin: content')
@Controller('admin')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Post('courses/:id/generate-content')
  @RequirePermission('content.generate', { entity: 'course', param: 'id' })
  @ApiOk(V.GenerationBatchSchema, { status: 202 })
  generate(
    @IdParam() id: string,
    @ZodBody(V.GenerateContentSchema) body: z.output<typeof V.GenerateContentSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.content.startGeneration(a, s, id, body);
  }

  @Get('topics/:id/materials')
  @RequirePermission('content.view', { entity: 'topic', param: 'id' })
  @ApiOk(V.LearningMaterialSchema, { list: true })
  materials(@IdParam() id: string, @Scope() s: TenantScope) {
    return this.content.listForTopic(s, id);
  }

  @Get('versions/:id')
  @RequirePermission('content.view', version)
  @ApiOk(V.ContentVersionSchema)
  get(@IdParam() id: string, @Scope() s: TenantScope) {
    return this.content.getVersion(s, id);
  }

  @Patch('versions/:id')
  @RequirePermission('content.edit', version)
  @ApiOk(V.ContentVersionSchema)
  update(
    @IdParam() id: string,
    @ZodBody(V.UpdateVersionSchema) body: z.output<typeof V.UpdateVersionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.content.updateDraft(a, s, id, body);
  }

  @Post('versions/:id/submit-review')
  @RequirePermission('content.submit_review', version)
  @ApiOk(V.ContentVersionSchema)
  submit(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.content.submit(a, s, id);
  }

  @Post('versions/:id/withdraw')
  @RequirePermission('content.submit_review', version)
  @ApiOk(V.ContentVersionSchema)
  withdraw(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.content.withdraw(a, s, id);
  }

  @Post('versions/:id/fork')
  @RequirePermission('content.edit', version)
  @ApiOk(V.ContentVersionSchema, { status: 201 })
  fork(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return this.content.fork(a, s, id);
  }

  @Post('versions/:id/reviews')
  @RequirePermission('content.review', version)
  @ApiOk(V.ContentVersionSchema)
  review(
    @IdParam() id: string,
    @ZodBody(V.ReviewDecisionSchema) body: z.output<typeof V.ReviewDecisionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.content.review(a, s, id, body);
  }

  @Get('reviews/queue')
  @RequirePermission('content.review')
  @ApiOk(V.ReviewQueueItemSchema, { list: true })
  queue(@Scope() s: TenantScope) {
    return this.content.reviewQueue(s);
  }
}
