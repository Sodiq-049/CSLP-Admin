/** Lifecycle enums — docs/05-content-lifecycle.md */
export const ACCOUNT_TYPES = ['admin', 'student'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_STATUSES = ['invited', 'active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const GENERATION_STATUSES = ['none', 'queued', 'generating', 'generated', 'failed'] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const REVIEW_STATUSES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'rejected',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const PUBLICATION_STATES = ['unpublished', 'scheduled', 'published', 'archived'] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const MATERIAL_KINDS = [
  'notes_comprehensive',
  'notes_simplified',
  'revision_pack',
  'quiz',
  'video',
  'resource',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const PROGRAMME_AWARDS = ['ND', 'HND', 'BSc', 'PGD', 'other'] as const;
export type ProgrammeAward = (typeof PROGRAMME_AWARDS)[number];

export const INSTITUTION_STATUSES = ['active', 'suspended'] as const;
export type InstitutionStatus = (typeof INSTITUTION_STATUSES)[number];

export const SOURCE_CATEGORIES = [
  'course_outline',
  'lecture_notes',
  'textbook_excerpt',
  'reference',
  'technical_doc',
  'other',
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const LICENCE_TYPES = ['institution_owned', 'licensed', 'open', 'fair_use_excerpt'] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const PROCESSING_STATUSES = [
  'uploaded',
  'scanning',
  'extracting',
  'chunking',
  'embedding',
  'ready',
  'failed',
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const OUTLINE_STATUSES = ['draft', 'approved', 'superseded'] as const;
export type OutlineStatus = (typeof OUTLINE_STATUSES)[number];

export const OUTLINE_ORIGINS = ['manual', 'upload', 'paste'] as const;
export type OutlineOrigin = (typeof OUTLINE_ORIGINS)[number];

export const EXTRACTION_STATUSES = [
  'none',
  'pending',
  'extracting',
  'suggested',
  'failed',
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const JOB_TYPES = [
  'document_ingest',
  'outline_extraction',
  'content_generation',
  'quiz_generation',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['queued', 'active', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Upload limits (docs/06 §2). */
export const UPLOAD_LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  mimeTypes: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'text/plain': 'txt',
  },
} as const;

/** Material kinds the AI Content Studio can generate in Phase 3a. */
export const GENERATABLE_KINDS = [
  'notes_comprehensive',
  'notes_simplified',
  'revision_pack',
] as const;
export type GeneratableKind = (typeof GENERATABLE_KINDS)[number];

export const DISPLAY_STATUSES = [
  'generating',
  'failed',
  'draft',
  'in_review',
  'changes_requested',
  'rejected',
  'approved',
  'published',
  'published_with_draft',
  'scheduled',
  'unpublished',
  'archived',
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

export const PROVENANCE = ['official', 'source_grounded', 'ai_supplementary'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const QUESTION_TYPES = ['mcq_single', 'true_false', 'fill_gap', 'short_answer'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const EDITOR_ACTIONS = [
  'simplify',
  'expand',
  'rewrite_beginner',
  'add_examples',
  'grammar',
  'clarity',
  'revision_points',
] as const;
export type EditorAction = (typeof EDITOR_ACTIONS)[number];
