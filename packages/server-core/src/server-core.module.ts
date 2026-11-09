import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleInit,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Schema } from 'mongoose';
import { CORE_CONFIG, type CoreConfig } from './config.js';
import { MODELS } from './database/model-names.js';
import { auditLogSchema } from './audit/audit-log.schema.js';
import { AuditLogService } from './audit/audit-log.service.js';
import {
  authSessionSchema,
  invitationSchema,
  roleAssignmentSchema,
  userSchema,
  verificationTokenSchema,
} from './identity/identity.schemas.js';
import {
  enrolmentSchema,
  materialProgressSchema,
  quizAttemptSchema,
} from './learning/learning.schemas.js';
import { LearningService } from './learning/learning.service.js';
import { InsightsService } from './learning/insights.service.js';
import {
  academicLevelSchema,
  curriculumVersionSchema,
  departmentSchema,
  facultySchema,
  institutionSchema,
  programmeSchema,
  semesterSchema,
} from './academic/academic.schemas.js';
import { InstitutionsService } from './academic/institutions.service.js';
import { AcademicStructureService } from './academic/academic-structure.service.js';
import { courseOutlineSchema, courseSchema, topicSchema } from './courses/course.schemas.js';
import { CoursesService } from './courses/courses.service.js';
import { TopicsService } from './courses/topics.service.js';
import { OutlinesService } from './courses/outlines.service.js';
import {
  aiUsageSchema,
  documentChunkSchema,
  generationJobSchema,
  mediaAssetSchema,
  sourceDocumentSchema,
} from './sources/source.schemas.js';
import { SourceDocumentsService } from './sources/source-documents.service.js';
import { ObjectStorage } from './storage/object-storage.js';
import { MalwareScanner } from './storage/malware-scanner.js';
import { JobQueue } from './jobs/job-queue.js';
import { JobsService } from './jobs/jobs.service.js';
import { AiService } from './ai/ai.service.js';
import { IngestionProcessor } from './ingest/ingestion.processor.js';
import { OutlineExtractionProcessor } from './ingest/outline-extraction.processor.js';
import {
  contentReviewSchema,
  contentVersionSchema,
  learningMaterialSchema,
} from './content/content.schemas.js';
import { ContentService } from './content/content.service.js';
import { RetrievalService } from './content/retrieval.service.js';
import { GenerationProcessor } from './content/generation.processor.js';
import { EditorActionsService } from './content/editor-actions.service.js';
import { UsageService } from './ai/usage.service.js';
import { questionSchema } from './quizzes/question.schema.js';
import { QuestionsService } from './quizzes/questions.service.js';
import { QuizGenerationProcessor } from './quizzes/quiz-generation.processor.js';
import { publicationEventSchema } from './publishing/publication-event.schema.js';
import { PublishingService } from './publishing/publishing.service.js';
import { PublishedContentService } from './publishing/published-content.service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous schema list
export const MODEL_DEFINITIONS: { name: string; schema: Schema<any> }[] = [
  { name: MODELS.User, schema: userSchema },
  { name: MODELS.RoleAssignment, schema: roleAssignmentSchema },
  { name: MODELS.AuthSession, schema: authSessionSchema },
  { name: MODELS.Invitation, schema: invitationSchema },
  { name: MODELS.Institution, schema: institutionSchema },
  { name: MODELS.Faculty, schema: facultySchema },
  { name: MODELS.Department, schema: departmentSchema },
  { name: MODELS.Programme, schema: programmeSchema },
  { name: MODELS.AcademicLevel, schema: academicLevelSchema },
  { name: MODELS.Semester, schema: semesterSchema },
  { name: MODELS.CurriculumVersion, schema: curriculumVersionSchema },
  { name: MODELS.AuditLog, schema: auditLogSchema },
  { name: MODELS.Course, schema: courseSchema },
  { name: MODELS.CourseOutline, schema: courseOutlineSchema },
  { name: MODELS.Topic, schema: topicSchema },
  { name: MODELS.SourceDocument, schema: sourceDocumentSchema },
  { name: MODELS.DocumentChunk, schema: documentChunkSchema },
  { name: MODELS.MediaAsset, schema: mediaAssetSchema },
  { name: MODELS.GenerationJob, schema: generationJobSchema },
  { name: MODELS.AiUsage, schema: aiUsageSchema },
  { name: MODELS.LearningMaterial, schema: learningMaterialSchema },
  { name: MODELS.ContentVersion, schema: contentVersionSchema },
  { name: MODELS.ContentReview, schema: contentReviewSchema },
  { name: MODELS.Question, schema: questionSchema },
  { name: MODELS.PublicationEvent, schema: publicationEventSchema },
  { name: MODELS.VerificationToken, schema: verificationTokenSchema },
  { name: MODELS.Enrolment, schema: enrolmentSchema },
  { name: MODELS.MaterialProgress, schema: materialProgressSchema },
  { name: MODELS.QuizAttempt, schema: quizAttemptSchema },
];

/** In inline mode, background jobs run in-process (tests, Redis-less dev). */
@Injectable()
class InlineProcessorRegistrar implements OnModuleInit {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly queue: JobQueue,
    private readonly ingestion: IngestionProcessor,
    private readonly outlines: OutlineExtractionProcessor,
    private readonly generation: GenerationProcessor,
    private readonly quizzes: QuizGenerationProcessor,
  ) {}
  onModuleInit() {
    if (this.config.queue.mode !== 'inline') return;
    this.queue.registerInlineHandler('document_ingest', this.ingestion.handle);
    this.queue.registerInlineHandler('outline_extraction', this.outlines.handle);
    this.queue.registerInlineHandler('content_generation', this.generation.handle);
    this.queue.registerInlineHandler('quiz_generation', this.quizzes.handle);
  }
}

const SERVICES = [
  AuditLogService,
  InstitutionsService,
  AcademicStructureService,
  CoursesService,
  TopicsService,
  OutlinesService,
  SourceDocumentsService,
  ObjectStorage,
  MalwareScanner,
  JobQueue,
  JobsService,
  AiService,
  IngestionProcessor,
  OutlineExtractionProcessor,
  ContentService,
  RetrievalService,
  GenerationProcessor,
  EditorActionsService,
  UsageService,
  QuestionsService,
  QuizGenerationProcessor,
  PublishingService,
  PublishedContentService,
  LearningService,
  InsightsService,
];

/**
 * Domain layer shared by apps/api and apps/worker. The host provides the Mongo connection
 * (MongooseModule.forRoot*) and a CoreConfig.
 */
@Global()
@Module({})
export class ServerCoreModule {
  static forRoot(config: CoreConfig): DynamicModule {
    return {
      module: ServerCoreModule,
      global: true,
      imports: [MongooseModule.forFeature(MODEL_DEFINITIONS)],
      providers: [
        { provide: CORE_CONFIG, useValue: config },
        ...SERVICES,
        InlineProcessorRegistrar,
      ],
      exports: [MongooseModule, CORE_CONFIG, ...SERVICES],
    };
  }
}
