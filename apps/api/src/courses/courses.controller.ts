import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  CoursesService,
  TopicsService,
  toTopicDto,
  type Actor,
  type TenantScope,
} from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const course = { entity: 'course', param: 'id' } as const;
const topic = { entity: 'topic', param: 'id' } as const;

@ApiTags('admin: courses')
@Controller('admin')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly topics: TopicsService,
  ) {}

  @Get('courses')
  @RequirePermission('course.view')
  @ApiOk(V.CourseSchema, { list: true })
  async list(
    @ZodQuery(V.CourseListQuerySchema) q: z.output<typeof V.CourseListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.courses.list(s, q);
    return new PageResult(await this.courses.toDtos(r.items), r.total, q.page, q.pageSize);
  }

  /** Institution is derived from the programme; the service checks it against the caller's scope. */
  @Post('courses')
  @RequirePermission('course.create')
  @ApiOk(V.CourseSchema, { status: 201 })
  async create(
    @ZodBody(V.CreateCourseSchema) body: z.output<typeof V.CreateCourseSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    const [dto] = await this.courses.toDtos([await this.courses.create(a, s, body)]);
    return dto;
  }

  @Get('courses/:id')
  @RequirePermission('course.view', course)
  @ApiOk(V.CourseSchema)
  async get(@IdParam() id: string, @Scope() s: TenantScope) {
    const [dto] = await this.courses.toDtos([await this.courses.load(s, id)]);
    return dto;
  }

  @Patch('courses/:id')
  @RequirePermission('course.update', course)
  @ApiOk(V.CourseSchema)
  async update(
    @IdParam() id: string,
    @ZodBody(V.UpdateCourseSchema) body: z.output<typeof V.UpdateCourseSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    const [dto] = await this.courses.toDtos([await this.courses.update(a, s, id, body)]);
    return dto;
  }

  @Post('courses/:id/archive')
  @RequirePermission('course.archive', course)
  @ApiOk(V.CourseSchema)
  async archive(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    const [dto] = await this.courses.toDtos([await this.courses.archive(a, s, id)]);
    return dto;
  }

  /* ───────── topics ───────── */

  @Get('courses/:id/topics')
  @RequirePermission('course.view', course)
  @ApiOk(V.TopicTreeNodeSchema, { list: true })
  tree(
    @IdParam() id: string,
    @ZodQuery(V.TopicTreeQuerySchema) q: z.output<typeof V.TopicTreeQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    return this.topics.tree(s, id, q.includeArchived);
  }

  @Post('courses/:id/topics')
  @RequirePermission('topic.manage', course)
  @ApiOk(V.TopicSchema, { status: 201 })
  async createTopic(
    @IdParam() id: string,
    @ZodBody(V.CreateTopicSchema) body: z.output<typeof V.CreateTopicSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toTopicDto(await this.topics.create(a, s, id, body));
  }

  @Patch('topics/:id')
  @RequirePermission('topic.manage', topic)
  @ApiOk(V.TopicSchema)
  async updateTopic(
    @IdParam() id: string,
    @ZodBody(V.UpdateTopicSchema) body: z.output<typeof V.UpdateTopicSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toTopicDto(await this.topics.update(a, s, id, body));
  }

  @Post('topics/:id/move')
  @RequirePermission('topic.manage', topic)
  @ApiOk(V.TopicSchema)
  async moveTopic(
    @IdParam() id: string,
    @ZodBody(V.MoveTopicSchema) body: z.output<typeof V.MoveTopicSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return toTopicDto(await this.topics.move(a, s, id, body));
  }

  @Post('topics/:id/archive')
  @RequirePermission('topic.manage', topic)
  @ApiOk(V.TopicSchema)
  async archiveTopic(@IdParam() id: string, @Scope() s: TenantScope, @CurrentActor() a: Actor) {
    return toTopicDto(await this.topics.archive(a, s, id));
  }
}
