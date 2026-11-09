import { Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import * as V from '@cslp/validation';
import {
  EditorActionsService,
  QuestionsService,
  UsageService,
  type Actor,
  type TenantScope,
} from '@cslp/server-core';
import { PageResult } from '../common/http.js';
import { ApiOk, IdParam, ZodBody, ZodQuery } from '../common/zod.js';
import { CurrentActor, RequirePermission, Scope } from '../auth/decorators.js';

const version = { entity: 'version', param: 'id' } as const;
const question = { entity: 'question', param: 'id' } as const;

@ApiTags('admin: quizzes & AI tools')
@Controller('admin')
export class QuizzesController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly editor: EditorActionsService,
    private readonly usage: UsageService,
  ) {}

  @Post('versions/:id/generate-questions')
  @RequirePermission('quiz.manage', version)
  @ApiOk(V.QuestionJobSchema, { status: 202 })
  generate(
    @IdParam() id: string,
    @ZodBody(V.GenerateQuestionsSchema) body: z.output<typeof V.GenerateQuestionsSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.questions.startGeneration(a, s, id, body);
  }

  @Get('questions')
  @RequirePermission('content.view')
  @ApiOk(V.QuestionSchema, { list: true })
  async list(
    @ZodQuery(V.QuestionListQuerySchema) q: z.output<typeof V.QuestionListQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    const r = await this.questions.list(s, q);
    return new PageResult(await this.questions.toDtos(r.items), r.total, q.page, q.pageSize);
  }

  @Get('questions/:id')
  @RequirePermission('content.view', question)
  @ApiOk(V.QuestionSchema)
  async get(@IdParam() id: string, @Scope() s: TenantScope) {
    return (await this.questions.toDtos([await this.questions.get(s, id)]))[0];
  }

  @Patch('questions/:id')
  @RequirePermission('quiz.manage', question)
  @ApiOk(V.QuestionSchema)
  async update(
    @IdParam() id: string,
    @ZodBody(V.UpdateQuestionSchema) body: z.output<typeof V.UpdateQuestionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return (await this.questions.toDtos([await this.questions.update(a, s, id, body)]))[0];
  }

  @Post('questions/:id/review')
  @RequirePermission('question.review', question)
  @ApiOk(V.QuestionSchema)
  async review(
    @IdParam() id: string,
    @ZodBody(V.QuestionReviewSchema) body: z.output<typeof V.QuestionReviewSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return (await this.questions.toDtos([await this.questions.review(a, s, id, body)]))[0];
  }

  @Post('topics/:id/quizzes')
  @RequirePermission('quiz.manage', { entity: 'topic', param: 'id' })
  @ApiOk(V.ContentVersionSchema, { status: 201 })
  compose(
    @IdParam() id: string,
    @ZodBody(V.ComposeQuizSchema) body: z.output<typeof V.ComposeQuizSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.questions.composeQuiz(a, s, id, body);
  }

  @Get('versions/:id/quiz-questions')
  @RequirePermission('content.view', version)
  @ApiOk(V.QuestionSchema, { list: true })
  async quizQuestions(@IdParam() id: string, @Scope() s: TenantScope) {
    return this.questions.toDtos(await this.questions.quizQuestions(s, id));
  }

  @Post('versions/:id/ai-actions')
  @RequirePermission('content.generate', version)
  @ApiOk(V.EditorActionResultSchema)
  aiAction(
    @IdParam() id: string,
    @ZodBody(V.EditorActionSchema) body: z.output<typeof V.EditorActionSchema>,
    @Scope() s: TenantScope,
    @CurrentActor() a: Actor,
  ) {
    return this.editor.suggest(a, s, id, body);
  }

  @Get('ai-usage/summary')
  @RequirePermission('ai_usage.view')
  @ApiOk(V.AiUsageSummarySchema)
  usageSummary(
    @ZodQuery(V.AiUsageQuerySchema) q: z.output<typeof V.AiUsageQuerySchema>,
    @Scope() s: TenantScope,
  ) {
    return this.usage.summary(s, q);
  }
}
