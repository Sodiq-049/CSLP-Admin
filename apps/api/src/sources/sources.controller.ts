import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  AppError,
  JobsService,
  SourceDocumentsService,
  toChunkDto,
  toJobDto,
  type Actor,
  type TenantScope,
  type UploadedFile,
} from '@cslp/server-core';
import { Types } from 'mongoose';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodQuery } from '../common/zod.js';
import { UploadedDocument, UploadEndpoint, UploadFields } from '../common/upload.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const source = { entity: 'sourceDocument', param: 'id' } as const;

@ApiTags('admin: source documents')
@Controller('admin')
export class SourcesController {
  constructor(
    private readonly sources: SourceDocumentsService,
    private readonly jobs: JobsService,
  ) {}

  @Get('source-documents')
  @RequirePermission('content.view')
  @ApiOk(V.SourceDocumentSchema, { list: true })
  async list(
    @ZodQuery(V.SourceListQuerySchema) q: z.output<typeof V.SourceListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.sources.list(s, q);
    return new PageResult(await this.sources.toDtos(r.items), r.total, q.page, q.pageSize);
  }

  @Post('institutions/:institutionId/source-documents')
  @RequirePermission('source.upload', { institutionParam: 'institutionId' })
  @UploadEndpoint(V.UploadSourceFieldsSchema)
  @ApiOk(V.SourceDocumentSchema, { status: 201 })
  async upload(
    @IdParam('institutionId') institutionId: string,
    @UploadFields(V.UploadSourceFieldsSchema) f: z.output<typeof V.UploadSourceFieldsSchema>,
    @UploadedDocument() file: UploadedFile,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    const { doc } = await this.sources.upload(a, s, institutionId, file, {
      title: f.title,
      category: f.category,
      courseId: f.courseId,
      authors: f.authors,
      publisher: f.publisher,
      year: f.year,
      licenceType: f.licenceType,
      licenceNotes: f.licenceNotes,
    });
    return (await this.sources.toDtos([doc]))[0];
  }

  @Get('source-documents/:id')
  @RequirePermission('content.view', source)
  @ApiOk(V.SourceDocumentSchema)
  async get(@IdParam() id: string, @Scope() s: TenantScope) {
    return (await this.sources.toDtos([await this.sources.load(s, id)]))[0];
  }

  @Get('source-documents/:id/chunks')
  @RequirePermission('content.view', source)
  @ApiOk(V.DocumentChunkSchema, { list: true })
  async chunks(
    @IdParam() id: string,
    @ZodQuery(V.ChunkQuerySchema) q: z.output<typeof V.ChunkQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.sources.chunks(s, id, q.page, q.pageSize);
    return new PageResult(r.items.map(toChunkDto), r.total, q.page, q.pageSize);
  }

  @Get('source-documents/:id/download')
  @RequirePermission('content.view', source)
  @ApiOk(V.DownloadUrlSchema)
  async download(@IdParam() id: string, @Scope() s: TenantScope) {
    const r = await this.sources.downloadUrl(s, id);
    return { url: r.url, expiresAt: r.expiresAt.toISOString() };
  }

  @Get('source-documents/:id/jobs')
  @RequirePermission('ai_jobs.view', source)
  @ApiOk(V.GenerationJobSchema, { list: true })
  async jobs_(@IdParam() id: string, @Scope() s: TenantScope) {
    const doc = await this.sources.load(s, id);
    return (await this.jobs.listForTargets(doc.institutionId, { sourceDocumentId: doc._id })).map(
      toJobDto,
    );
  }

  @Post('source-documents/:id/approve-for-generation')
  @RequirePermission('source.approve_for_generation', source)
  @ApiOk(V.SourceDocumentSchema)
  async approve(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return (await this.sources.toDtos([await this.sources.setApproval(a, s, id, true)]))[0];
  }

  @Post('source-documents/:id/revoke-approval')
  @RequirePermission('source.approve_for_generation', source)
  @ApiOk(V.SourceDocumentSchema)
  async revoke(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return (await this.sources.toDtos([await this.sources.setApproval(a, s, id, false)]))[0];
  }

  @Post('source-documents/:id/reprocess')
  @RequirePermission('source.upload', source)
  @ApiOk(V.SourceDocumentSchema)
  async reprocess(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return (await this.sources.toDtos([await this.sources.reprocess(a, s, id)]))[0];
  }

  @Delete('source-documents/:id')
  @RequirePermission('source.delete', source)
  @ApiOk(V.OkSchema)
  async remove(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    await this.sources.remove(a, s, id);
    return { ok: true as const };
  }

  @Get('ai-jobs/:id')
  @RequirePermission('ai_jobs.view', { entity: 'job', param: 'id' })
  @ApiOk(V.GenerationJobSchema)
  async job(@IdParam() id: string, @Scope() s: TenantScope) {
    const instId = await this.jobs.resolveInstitutionId(id);
    const j = instId ? await this.jobs.get(new Types.ObjectId(instId), id) : null;
    if (!j || (s.kind === 'institutions' && !s.institutionIds.includes(String(j.institutionId))))
      throw AppError.notFound('Job');
    return toJobDto(j);
  }
}
