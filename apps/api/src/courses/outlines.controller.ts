import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  OutlinesService,
  toOutlineDto,
  type Actor,
  type TenantScope,
  type UploadedFile,
} from '@cslp/server-core';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { UploadedDocument, UploadEndpoint, UploadFields } from '../common/upload.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const course = { entity: 'course', param: 'id' } as const;
const outline = { entity: 'outline', param: 'id' } as const;

@ApiTags('admin: course outlines')
@Controller('admin')
export class OutlinesController {
  constructor(private readonly outlines: OutlinesService) {}

  @Get('courses/:id/outlines')
  @RequirePermission('course.view', course)
  @ApiOk(V.CourseOutlineSchema, { list: true })
  async list(@IdParam() id: string, @Scope() s: TenantScope) {
    return (await this.outlines.listForCourse(s, id)).map(toOutlineDto);
  }

  @Post('courses/:id/outlines')
  @RequirePermission('outline.upload', course)
  @ApiOk(V.CourseOutlineSchema, { status: 201 })
  async create(
    @IdParam() id: string,
    @ZodBody(V.CreateOutlineSchema) body: z.output<typeof V.CreateOutlineSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    const o =
      body.origin === 'paste'
        ? await this.outlines.createFromPaste(a, s, id, body.text)
        : await this.outlines.createManual(a, s, id, body.structure);
    return toOutlineDto(o);
  }

  @Post('courses/:id/outlines/upload')
  @RequirePermission('outline.upload', course)
  @UploadEndpoint(V.UploadOutlineFieldsSchema)
  @ApiOk(V.CourseOutlineSchema, { status: 201 })
  async upload(
    @IdParam() id: string,
    @UploadFields(V.UploadOutlineFieldsSchema) _fields: unknown,
    @UploadedDocument() file: UploadedFile,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toOutlineDto(await this.outlines.createFromUpload(a, s, id, file));
  }

  @Get('outlines')
  @RequirePermission('course.view')
  @ApiOk(V.OutlineReviewItemSchema, { list: true })
  async drafts(@Scope() s: TenantScope) {
    const items = await this.outlines.listDrafts(s);
    return items
      .filter((i) => i.course)
      .map((i) => ({
        outline: { ...toOutlineDto(i.outline), rawText: null },
        course: { id: String(i.course!._id), code: i.course!.code, title: i.course!.title },
      }));
  }

  @Get('outlines/:id')
  @RequirePermission('course.view', outline)
  @ApiOk(V.CourseOutlineSchema)
  async get(@IdParam() id: string, @Scope() s: TenantScope) {
    return toOutlineDto(await this.outlines.load(s, id));
  }

  @Patch('outlines/:id')
  @RequirePermission('outline.upload', outline)
  @ApiOk(V.CourseOutlineSchema)
  async update(
    @IdParam() id: string,
    @ZodBody(V.UpdateOutlineSchema) body: z.output<typeof V.UpdateOutlineSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toOutlineDto(await this.outlines.updateStructure(a, s, id, body.structure));
  }

  @Post('outlines/:id/approve')
  @RequirePermission('outline.approve', outline)
  @ApiOk(V.CourseOutlineSchema)
  async approve(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toOutlineDto(await this.outlines.approve(a, s, id));
  }

  @Post('outlines/:id/sync-topics')
  @RequirePermission('topic.manage', outline)
  @ApiOk(V.TopicSyncPlanSchema)
  sync(
    @IdParam() id: string,
    @ZodQuery(V.SyncTopicsQuerySchema) q: z.output<typeof V.SyncTopicsQuerySchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.outlines.syncTopics(a, s, id, q.apply);
  }

  @Get('outlines/:id/document')
  @RequirePermission('course.view', outline)
  @ApiOk(V.DownloadUrlSchema)
  async document(@IdParam() id: string, @Scope() s: TenantScope) {
    const r = await this.outlines.documentUrl(s, id);
    return { url: r.url, expiresAt: r.expiresAt.toISOString() };
  }
}
