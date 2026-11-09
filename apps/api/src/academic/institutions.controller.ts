import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  AcademicTreeSchema,
  CreateInstitutionSchema,
  InstitutionSchema,
  PageQuerySchema,
  UpdateInstitutionSchema,
} from '@cslp/validation';
import {
  AcademicStructureService,
  InstitutionsService,
  toInstitutionDto,
  type Actor,
  type TenantScope,
} from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const inst = { institutionParam: 'institutionId' } as const;

@ApiTags('admin: institutions')
@Controller('admin/institutions')
export class InstitutionsController {
  constructor(
    private readonly institutions: InstitutionsService,
    private readonly academic: AcademicStructureService,
  ) {}

  @Get()
  @RequirePermission('institution.view')
  @ApiOk(InstitutionSchema, { list: true })
  async list(
    @ZodQuery(PageQuerySchema) q: z.output<typeof PageQuerySchema>,
    @Scope() scope: TenantScope,
  ) {
    return PageResult.of(await this.institutions.list(scope, q), q, toInstitutionDto);
  }

  @Post()
  @RequirePermission('institution.create')
  @ApiOk(InstitutionSchema, { status: 201 })
  async create(
    @ZodBody(CreateInstitutionSchema) body: z.output<typeof CreateInstitutionSchema>,
    @CurrentActor() actor: Actor,
  ) {
    return toInstitutionDto(await this.institutions.create(actor, body));
  }

  @Get(':institutionId')
  @RequirePermission('institution.view', inst)
  @ApiOk(InstitutionSchema)
  async get(@IdParam('institutionId') id: string, @Scope() scope: TenantScope) {
    return toInstitutionDto(await this.institutions.get(scope, id));
  }

  @Patch(':institutionId')
  @RequirePermission('institution.update', inst)
  @ApiOk(InstitutionSchema)
  async update(
    @IdParam('institutionId') id: string,
    @ZodBody(UpdateInstitutionSchema) body: z.output<typeof UpdateInstitutionSchema>,
    @Scope() scope: TenantScope,
    @CurrentActor() actor: Actor,
  ) {
    return toInstitutionDto(await this.institutions.update(actor, scope, id, body));
  }

  @Post(':institutionId/archive')
  @RequirePermission('institution.archive', inst)
  @ApiOk(InstitutionSchema)
  async archive(
    @IdParam('institutionId') id: string,
    @Scope() scope: TenantScope,
    @CurrentActor() actor: Actor,
  ) {
    return toInstitutionDto(await this.institutions.archive(actor, scope, id));
  }

  @Get(':institutionId/academic-tree')
  @RequirePermission('academic.view', inst)
  @ApiOk(AcademicTreeSchema)
  tree(@IdParam('institutionId') id: string, @Scope() scope: TenantScope) {
    return this.academic.getTree(scope, id);
  }
}
