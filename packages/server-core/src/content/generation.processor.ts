import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  NotesOutputSchema,
  RevisionPackOutputSchema,
  type GenerationOptions,
  type NotesOutput,
  type RevisionPackOutput,
} from '@cslp/validation';
import { MODELS } from '../database/model-names.js';
import { AiService } from '../ai/ai.service.js';
import { JobsService, PermanentJobError, type ProgressFn } from '../jobs/jobs.service.js';
import type { GenerationJobDoc } from '../sources/source.schemas.js';
import type { CourseDoc, TopicDoc } from '../courses/course.schemas.js';
import type {
  AcademicLevelDoc,
  InstitutionDoc,
  ProgrammeDoc,
} from '../academic/academic.schemas.js';
import type { CitationDoc, ContentVersionDoc } from './content.schemas.js';
import { ContentService } from './content.service.js';
import { RetrievalService, type RetrievedPassage } from './retrieval.service.js';
import {
  notesPrompt,
  PROMPT_VERSION,
  retrievalQuery,
  revisionPrompt,
  type PromptContext,
} from './prompts.js';
import { placeholderNotes, placeholderRevision } from './placeholders.js';
import { docStats, notesToDoc, sanitizeDoc } from './rich-doc.js';
import { cleanModelText as clean } from './clean-text.js';

const TASK: Record<string, string> = {
  notes_comprehensive: 'notes.comprehensive',
  notes_simplified: 'notes.simplified',
  revision_pack: 'revision.pack',
};

/**
 * content_generation (docs/06 §3): context bundle → retrieval → structured generation →
 * citation validation → editor document. Output is always a draft.
 */
@Injectable()
export class GenerationProcessor {
  private readonly logger = new Logger(GenerationProcessor.name);
  constructor(
    @InjectModel(MODELS.ContentVersion) private readonly versions: Model<ContentVersionDoc>,
    @InjectModel(MODELS.Course) private readonly courses: Model<CourseDoc>,
    @InjectModel(MODELS.Topic) private readonly topics: Model<TopicDoc>,
    @InjectModel(MODELS.Programme) private readonly programmes: Model<ProgrammeDoc>,
    @InjectModel(MODELS.AcademicLevel) private readonly levels: Model<AcademicLevelDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
    private readonly retrieval: RetrievalService,
    private readonly ai: AiService,
    private readonly jobs: JobsService,
    private readonly content: ContentService,
  ) {}

  handle = (jobId: string, attempt: number) =>
    this.jobs.run(jobId, attempt, (job, progress) => this.process(job, progress));

  private async process(job: GenerationJobDoc, progress: ProgressFn): Promise<void> {
    const versionId = String(job.input.versionId ?? '');
    const scope = { _id: versionId, institutionId: job.institutionId };
    const v = await this.versions.findOne(scope).lean<ContentVersionDoc>();
    if (!v) throw new PermanentJobError('NOT_FOUND', 'Version no longer exists');
    const taskKey = TASK[v.kind];
    if (!taskKey) throw new PermanentJobError('UNSUPPORTED', `Cannot generate ${v.kind}`);
    const options = (job.input.options ?? {}) as GenerationOptions;
    try {
      await this.versions.updateOne(scope, { $set: { generationStatus: 'generating' } });
      await this.content.refreshStatus(v.materialId, v.institutionId);
      const mode = this.ai.textMode(taskKey);
      if (mode === 'none')
        throw new PermanentJobError(
          'NO_PROVIDER',
          'No AI text provider is configured. Set AI_TEXT_PROVIDER and the model for this task.',
        );

      await progress(15, 'gathering context');
      const ctx = await this.context(v, options);
      ctx.passages = await this.retrieval.retrieve({
        institutionId: v.institutionId,
        courseId: v.courseId,
        query: retrievalQuery(ctx),
        k: 10,
        jobId: job._id,
      });
      await progress(35, mode === 'fake' ? 'building placeholder' : 'writing');

      const call = { institutionId: v.institutionId, jobId: job._id, taskKey };
      const allowed = new Map(ctx.passages.map((p) => [p.label, p]));
      const warnings: string[] = [];
      if (mode === 'fake')
        warnings.push(
          'Development placeholder: generated without an AI model. Do not approve this as teaching content.',
        );
      if (!ctx.passages.length)
        warnings.push(
          'No approved sources matched this topic, so nothing could be cited. Upload and approve sources, then regenerate.',
        );

      const order: string[] = [];
      const cite = (label: string): number | null => {
        if (!allowed.has(label)) return null;
        if (!order.includes(label)) order.push(label);
        return order.indexOf(label) + 1;
      };
      const keepValid = (labels: string[], where: string) => {
        const ok = labels.filter((l) => allowed.has(l));
        if (ok.length < labels.length)
          warnings.push(
            `Removed citation(s) ${labels.filter((l) => !allowed.has(l)).join(', ')} in “${where.slice(0, 60)}”: not among the retrieved sources.`,
          );
        return ok;
      };

      let body: Record<string, unknown>;
      let insufficient = ctx.passages.length === 0;
      let missing: string[] = [];
      if (v.kind === 'revision_pack') {
        const out: RevisionPackOutput =
          mode === 'openai'
            ? await this.ai.generateStructured(call, {
                ...revisionPrompt(ctx),
                schema: RevisionPackOutputSchema,
                schemaName: 'revision_pack',
              })
            : placeholderRevision(ctx);
        const keyPoints = out.keyPoints.map((k) => {
          const citations = keepValid(k.citations, k.text);
          citations.forEach(cite);
          return { text: clean(k.text), citations };
        });
        body = {
          kind: 'revision_pack',
          summary: clean(out.summary),
          keyPoints,
          flashcards: out.flashcards.map((f) => ({ front: clean(f.front), back: clean(f.back) })),
          faq: out.faq.map((f) => ({ question: clean(f.question), answer: clean(f.answer) })),
          checklist: out.checklist.map(clean),
        };
        insufficient ||= out.insufficientSources;
        missing = out.missingTopics;
      } else {
        const simplified = v.kind === 'notes_simplified';
        const raw: NotesOutput =
          mode === 'openai'
            ? await this.ai.generateStructured(call, {
                ...notesPrompt(ctx, simplified),
                schema: NotesOutputSchema,
                schemaName: 'notes',
              })
            : placeholderNotes(ctx, simplified);
        // Citation check: unknown labels removed; "source_grounded" without any valid citation is downgraded.
        const out: NotesOutput = {
          ...raw,
          title: clean(raw.title),
          learningObjectives: raw.learningObjectives.map(clean),
          sections: raw.sections.map((s) => {
            const blocks = s.blocks.map((b) => ({
              ...b,
              text: b.kind === 'code' ? b.text : clean(b.text),
              items: b.items.map(clean),
              rows: b.rows.map((r) => r.map(clean)),
              citations: keepValid(b.citations, s.heading),
            }));
            const grounded =
              s.provenance === 'source_grounded' && blocks.some((b) => b.citations.length);
            if (s.provenance === 'source_grounded' && !grounded)
              warnings.push(
                `“${s.heading.slice(0, 60)}” claimed to be source-based but had no valid citations; marked as AI supplementary.`,
              );
            return {
              ...s,
              heading: clean(s.heading),
              blocks,
              provenance: grounded ? 'source_grounded' : 'ai_supplementary',
            };
          }),
          glossary: raw.glossary.map((g) => ({
            term: clean(g.term),
            definition: clean(g.definition),
            citations: keepValid(g.citations, g.term),
          })),
        };
        const doc = sanitizeDoc(notesToDoc(out, cite))!;
        body = { kind: 'notes', doc, ...docStats(doc) };
        insufficient ||= out.insufficientSources;
        missing = out.missingTopics;
      }

      const citations: CitationDoc[] = order.map((label, i) => {
        const p = allowed.get(label) as RetrievedPassage;
        return {
          label,
          index: i + 1,
          sourceDocumentId: p.sourceDocumentId,
          sourceTitle: p.sourceTitle,
          chunkId: p.chunkId,
          page: p.page,
          quote: p.text.slice(0, 400),
        };
      });
      await progress(90, 'saving');
      await this.versions.updateOne(
        { ...scope, frozenAt: null },
        {
          $set: {
            body,
            generationStatus: 'generated',
            provenance: {
              citations,
              insufficientSources: insufficient,
              missingTopics: missing.slice(0, 20),
              warnings: [...new Set(warnings)].slice(0, 30),
            },
            generation: {
              provider: mode,
              model: this.ai.modelFor(taskKey)!,
              taskKey,
              promptVersion: PROMPT_VERSION,
              jobId: job._id,
              options,
              error: null,
            },
          },
        },
      );
      await this.content.refreshStatus(v.materialId, v.institutionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      await this.versions.updateOne(scope, {
        $set: { generationStatus: 'failed', 'generation.error': message.slice(0, 500) },
      });
      await this.content.refreshStatus(v.materialId, v.institutionId);
      throw err;
    }
  }

  private async context(v: ContentVersionDoc, options: GenerationOptions): Promise<PromptContext> {
    const inst = { institutionId: v.institutionId };
    const [course, topic, subtopics, institution] = await Promise.all([
      this.courses.findOne({ ...inst, _id: v.courseId }).lean<CourseDoc>(),
      this.topics.findOne({ ...inst, _id: v.topicId }).lean<TopicDoc>(),
      this.topics
        .find({ ...inst, parentTopicId: v.topicId, archivedAt: null })
        .sort({ orderKey: 1 })
        .lean<TopicDoc[]>(),
      this.institutions.findById(v.institutionId).lean<InstitutionDoc>(),
    ]);
    if (!course || !topic)
      throw new PermanentJobError('NOT_FOUND', 'Course or topic no longer exists');
    const [programme, level] = await Promise.all([
      this.programmes.findOne({ ...inst, _id: course.programmeId }).lean<ProgrammeDoc>(),
      this.levels.findOne({ ...inst, _id: course.levelId }).lean<AcademicLevelDoc>(),
    ]);
    return {
      institutionName: institution?.name ?? '',
      courseCode: course.code,
      courseTitle: course.title,
      programme: programme?.name ?? '',
      level: level?.name ?? '',
      officialObjectives: course.objectives
        .filter((o) => o.source === 'official')
        .map((o) => o.text),
      topicTitle: topic.title,
      subtopics: subtopics.map((s) => s.title),
      topicObjectives: topic.learningObjectives.map((o) => o.text),
      passages: [],
      options,
    };
  }
}
