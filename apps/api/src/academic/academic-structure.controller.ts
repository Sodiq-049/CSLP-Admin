import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  AcademicStructureService,
  toCurriculumVersionDto,
  toDepartmentDto,
  toFacultyDto,
  toLevelDto,
  toProgrammeDto,
  toSemesterDto,
  type Actor,
  type TenantScope,
} from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

type Q = z.output<typeof V.PageQuerySchema>;
const inst = { institutionParam: 'institutionId' } as const;
const entity = (e: string, param = 'id') => ({ entity: e, param });

/**
 * Faculties, departments, programmes, levels, semesters, curriculum versions (docs/04 §3.2).
 * Collection routes are nested under their parent; item routes are flat.
 */
@ApiTags('admin: academic structure')
@Controller('admin')
export class AcademicStructureController {
  constructor(private readonly academic: AcademicStructureService) {}

  /* ───────── faculties ───────── */

  @Get('institutions/:institutionId/faculties')
  @RequirePermission('academic.view', inst)
  @ApiOk(V.FacultySchema, { list: true })
  async listFaculties(
    @IdParam('institutionId') id: string,
    @ZodQuery(V.PageQuerySchema) q: Q,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(await this.academic.listFaculties(s, id, q), q, toFacultyDto);
  }

  @Post('institutions/:institutionId/faculties')
  @RequirePermission('academic.manage', inst)
  @ApiOk(V.FacultySchema, { status: 201 })
  async createFaculty(
    @IdParam('institutionId') id: string,
    @ZodBody(V.CreateFacultySchema) body: z.output<typeof V.CreateFacultySchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toFacultyDto(await this.academic.createFaculty(a, s, id, body));
  }

  @Patch('faculties/:id')
  @RequirePermission('academic.manage', entity('faculty'))
  @ApiOk(V.FacultySchema)
  async updateFaculty(
    @IdParam() id: string,
    @ZodBody(V.UpdateFacultySchema) body: z.output<typeof V.UpdateFacultySchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toFacultyDto(await this.academic.updateFaculty(a, s, id, body));
  }

  @Post('faculties/:id/archive')
  @RequirePermission('academic.manage', entity('faculty'))
  @ApiOk(V.FacultySchema)
  async archiveFaculty(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toFacultyDto(await this.academic.archiveFaculty(a, s, id));
  }

  /* ───────── departments ───────── */

  @Get('institutions/:institutionId/departments')
  @RequirePermission('academic.view', inst)
  @ApiOk(V.DepartmentSchema, { list: true })
  async listDepartments(
    @IdParam('institutionId') id: string,
    @ZodQuery(V.DepartmentListQuerySchema) q: z.output<typeof V.DepartmentListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(await this.academic.listDepartments(s, id, q), q, toDepartmentDto);
  }

  @Post('institutions/:institutionId/departments')
  @RequirePermission('academic.manage', inst)
  @ApiOk(V.DepartmentSchema, { status: 201 })
  async createDepartment(
    @IdParam('institutionId') id: string,
    @ZodBody(V.CreateDepartmentSchema) body: z.output<typeof V.CreateDepartmentSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toDepartmentDto(await this.academic.createDepartment(a, s, id, body));
  }

  @Patch('departments/:id')
  @RequirePermission('academic.manage', entity('department'))
  @ApiOk(V.DepartmentSchema)
  async updateDepartment(
    @IdParam() id: string,
    @ZodBody(V.UpdateDepartmentSchema) body: z.output<typeof V.UpdateDepartmentSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toDepartmentDto(await this.academic.updateDepartment(a, s, id, body));
  }

  @Post('departments/:id/archive')
  @RequirePermission('academic.manage', entity('department'))
  @ApiOk(V.DepartmentSchema)
  async archiveDepartment(
    @IdParam() id: string,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toDepartmentDto(await this.academic.archiveDepartment(a, s, id));
  }

  /* ───────── programmes ───────── */

  @Get('institutions/:institutionId/programmes')
  @RequirePermission('academic.view', inst)
  @ApiOk(V.ProgrammeSchema, { list: true })
  async listProgrammes(
    @IdParam('institutionId') id: string,
    @ZodQuery(V.ProgrammeListQuerySchema) q: z.output<typeof V.ProgrammeListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(await this.academic.listProgrammes(s, id, q), q, toProgrammeDto);
  }

  @Post('institutions/:institutionId/programmes')
  @RequirePermission('academic.manage', inst)
  @ApiOk(V.ProgrammeSchema, { status: 201 })
  async createProgramme(
    @IdParam('institutionId') id: string,
    @ZodBody(V.CreateProgrammeSchema) body: z.output<typeof V.CreateProgrammeSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toProgrammeDto(await this.academic.createProgramme(a, s, id, body));
  }

  @Patch('programmes/:id')
  @RequirePermission('academic.manage', entity('programme'))
  @ApiOk(V.ProgrammeSchema)
  async updateProgramme(
    @IdParam() id: string,
    @ZodBody(V.UpdateProgrammeSchema) body: z.output<typeof V.UpdateProgrammeSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toProgrammeDto(await this.academic.updateProgramme(a, s, id, body));
  }

  @Post('programmes/:id/archive')
  @RequirePermission('academic.manage', entity('programme'))
  @ApiOk(V.ProgrammeSchema)
  async archiveProgramme(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toProgrammeDto(await this.academic.archiveProgramme(a, s, id));
  }

  /* ───────── levels ───────── */

  @Get('programmes/:programmeId/levels')
  @RequirePermission('academic.view', entity('programme', 'programmeId'))
  @ApiOk(V.LevelSchema, { list: true })
  async listLevels(
    @IdParam('programmeId') id: string,
    @ZodQuery(V.PageQuerySchema) q: Q,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(await this.academic.listLevels(s, id, q), q, toLevelDto);
  }

  @Post('programmes/:programmeId/levels')
  @RequirePermission('academic.manage', entity('programme', 'programmeId'))
  @ApiOk(V.LevelSchema, { status: 201 })
  async createLevel(
    @IdParam('programmeId') id: string,
    @ZodBody(V.CreateLevelSchema) body: z.output<typeof V.CreateLevelSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toLevelDto(await this.academic.createLevel(a, s, id, body));
  }

  @Patch('levels/:id')
  @RequirePermission('academic.manage', entity('level'))
  @ApiOk(V.LevelSchema)
  async updateLevel(
    @IdParam() id: string,
    @ZodBody(V.UpdateLevelSchema) body: z.output<typeof V.UpdateLevelSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toLevelDto(await this.academic.updateLevel(a, s, id, body));
  }

  @Post('levels/:id/archive')
  @RequirePermission('academic.manage', entity('level'))
  @ApiOk(V.LevelSchema)
  async archiveLevel(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toLevelDto(await this.academic.archiveLevel(a, s, id));
  }

  /* ───────── semesters ───────── */

  @Get('institutions/:institutionId/semesters')
  @RequirePermission('academic.view', inst)
  @ApiOk(V.SemesterSchema, { list: true })
  async listSemesters(
    @IdParam('institutionId') id: string,
    @ZodQuery(V.PageQuerySchema) q: Q,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(await this.academic.listSemesters(s, id, q), q, toSemesterDto);
  }

  @Post('institutions/:institutionId/semesters')
  @RequirePermission('academic.manage', inst)
  @ApiOk(V.SemesterSchema, { status: 201 })
  async createSemester(
    @IdParam('institutionId') id: string,
    @ZodBody(V.CreateSemesterSchema) body: z.output<typeof V.CreateSemesterSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toSemesterDto(await this.academic.createSemester(a, s, id, body));
  }

  @Patch('semesters/:id')
  @RequirePermission('academic.manage', entity('semester'))
  @ApiOk(V.SemesterSchema)
  async updateSemester(
    @IdParam() id: string,
    @ZodBody(V.UpdateSemesterSchema) body: z.output<typeof V.UpdateSemesterSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toSemesterDto(await this.academic.updateSemester(a, s, id, body));
  }

  @Post('semesters/:id/archive')
  @RequirePermission('academic.manage', entity('semester'))
  @ApiOk(V.SemesterSchema)
  async archiveSemester(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toSemesterDto(await this.academic.archiveSemester(a, s, id));
  }

  /* ───────── curriculum versions ───────── */

  @Get('institutions/:institutionId/curriculum-versions')
  @RequirePermission('academic.view', inst)
  @ApiOk(V.CurriculumVersionSchema, { list: true })
  async listCurricula(
    @IdParam('institutionId') id: string,
    @ZodQuery(V.PageQuerySchema) q: Q,
    @Scope() s: TenantScope,
  ) {
    return PageResult.of(
      await this.academic.listCurriculumVersions(s, id, q),
      q,
      toCurriculumVersionDto,
    );
  }

  @Post('institutions/:institutionId/curriculum-versions')
  @RequirePermission('academic.manage', inst)
  @ApiOk(V.CurriculumVersionSchema, { status: 201 })
  async createCurriculum(
    @IdParam('institutionId') id: string,
    @ZodBody(V.CreateCurriculumVersionSchema)
    body: z.output<typeof V.CreateCurriculumVersionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toCurriculumVersionDto(await this.academic.createCurriculumVersion(a, s, id, body));
  }

  @Patch('curriculum-versions/:id')
  @RequirePermission('academic.manage', entity('curriculumVersion'))
  @ApiOk(V.CurriculumVersionSchema)
  async updateCurriculum(
    @IdParam() id: string,
    @ZodBody(V.UpdateCurriculumVersionSchema)
    body: z.output<typeof V.UpdateCurriculumVersionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toCurriculumVersionDto(await this.academic.updateCurriculumVersion(a, s, id, body));
  }
}
