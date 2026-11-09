import { Controller, Get, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import { LearningService, PublishedContentService } from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth } from '../auth/decorators.js';

/**
 * Student API for the website and mobile app (docs/04 §3.10). Published content only, via
 * PublishedContentService; the institution always comes from the student's own profile.
 */
@ApiTags('student')
@Controller('student')
export class StudentController {
  constructor(
    private readonly published: PublishedContentService,
    private readonly learning: LearningService,
  ) {}

  private inst(auth: AuthContext) {
    return this.published.studentInstitution(auth.userId);
  }

  @Get('courses')
  @ApiOk(V.StudentCourseSummarySchema, { list: true })
  async courses(
    @ZodQuery(V.StudentCourseQuerySchema) q: z.output<typeof V.StudentCourseQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    const r = await this.published.listCourses(await this.inst(auth), q);
    return new PageResult(r.items, r.total, q.page, q.pageSize);
  }

  @Get('courses/:id')
  @ApiOk(V.StudentCourseDetailSchema)
  async course(@IdParam() id: string, @CurrentAuth() auth: AuthContext) {
    return this.published.courseDetail(await this.inst(auth), id);
  }

  @Get('materials/:id')
  @ApiOk(V.StudentMaterialSchema)
  async material(@IdParam() id: string, @CurrentAuth() auth: AuthContext) {
    return this.published.material(await this.inst(auth), id);
  }

  /* ───────────── enrolments & progress ───────────── */

  @Get('enrolments')
  @ApiOk(V.EnrolmentSchema, { list: true })
  async enrolments(@CurrentAuth() auth: AuthContext) {
    return this.learning.listEnrolments(auth.userId, await this.inst(auth));
  }

  @Post('enrolments')
  @ApiOk(V.EnrolmentSchema, { status: 201 })
  async enrol(
    @ZodBody(V.EnrolSchema) body: z.output<typeof V.EnrolSchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.learning.enrol(auth.userId, await this.inst(auth), body.courseId);
  }

  @Get('progress')
  @ApiOk(V.ProgressSchema, { list: true })
  async progress(
    @ZodQuery(V.ProgressQuerySchema) q: z.output<typeof V.ProgressQuerySchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.learning.listProgress(auth.userId, await this.inst(auth), q.courseId);
  }

  @Put('progress/:id')
  @ApiOk(V.ProgressSchema)
  async updateProgress(
    @IdParam() id: string,
    @ZodBody(V.ProgressUpdateSchema) body: z.output<typeof V.ProgressUpdateSchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.learning.updateProgress(auth.userId, await this.inst(auth), id, body);
  }

  /* ───────────── quiz attempts ───────────── */

  @Post('materials/:id/attempts')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOk(V.QuizAttemptResultSchema, { status: 201 })
  async attempt(
    @IdParam() id: string,
    @ZodBody(V.QuizAttemptSchema) body: z.output<typeof V.QuizAttemptSchema>,
    @CurrentAuth() auth: AuthContext,
  ) {
    return this.learning.submitAttempt(auth.userId, await this.inst(auth), id, body);
  }

  @Get('materials/:id/attempts')
  @ApiOk(V.QuizAttemptSummarySchema, { list: true })
  async attempts(@IdParam() id: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.listAttempts(auth.userId, await this.inst(auth), id);
  }
}
