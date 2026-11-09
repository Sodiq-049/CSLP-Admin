import { Module, type OnModuleInit } from '@nestjs/common';
import {
  ContentService,
  InsightsService,
  PublishingService,
  QuestionsService,
  CoursesService,
  JobsService,
  OutlinesService,
  SourceDocumentsService,
  TopicsService,
} from '@cslp/server-core';
import { ScopeResolverRegistry } from '../auth/scope-resolver.registry.js';
import { CoursesController } from './courses.controller.js';
import { OutlinesController } from './outlines.controller.js';
import { SourcesController } from '../sources/sources.controller.js';
import { ContentController } from '../content/content.controller.js';
import { QuizzesController } from '../content/quizzes.controller.js';
import { PublishingController } from '../publishing/publishing.controller.js';
import { StudentController } from '../publishing/student.controller.js';
import { InsightsController } from '../insights/insights.controller.js';

@Module({
  controllers: [
    CoursesController,
    OutlinesController,
    SourcesController,
    ContentController,
    QuizzesController,
    PublishingController,
    StudentController,
    InsightsController,
  ],
})
export class ContentModule implements OnModuleInit {
  constructor(
    private readonly registry: ScopeResolverRegistry,
    private readonly courses: CoursesService,
    private readonly topics: TopicsService,
    private readonly outlines: OutlinesService,
    private readonly sources: SourceDocumentsService,
    private readonly jobs: JobsService,
    private readonly content: ContentService,
    private readonly questions: QuestionsService,
    private readonly publishing: PublishingService,
    private readonly insights: InsightsService,
  ) {}

  onModuleInit() {
    this.registry.register('course', (id) => this.courses.resolveInstitutionId(id));
    this.registry.register('topic', (id) => this.topics.resolveInstitutionId(id));
    this.registry.register('outline', (id) => this.outlines.resolveInstitutionId(id));
    this.registry.register('sourceDocument', (id) => this.sources.resolveInstitutionId(id));
    this.registry.register('job', (id) => this.jobs.resolveInstitutionId(id));
    this.registry.register('version', (id) => this.content.resolveVersionInstitution(id));
    this.registry.register('question', (id) => this.questions.resolveInstitutionId(id));
    this.registry.register('material', (id) => this.publishing.resolveMaterialInstitution(id));
    this.registry.register('student', (id) => this.insights.resolveStudentInstitution(id));
  }
}
