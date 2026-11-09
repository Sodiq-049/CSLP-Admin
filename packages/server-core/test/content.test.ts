import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CreateCourseSchema,
  CreateInstitutionSchema,
  GenerationOptionsSchema,
  type NotesOutput,
} from '@cslp/validation';
import {
  AcademicStructureService,
  AppError,
  ContentService,
  CoursesService,
  InstitutionsService,
  JobQueue,
  ServerCoreModule,
  SourceDocumentsService,
  TopicsService,
  notesToDoc,
  sanitizeDoc,
  type Actor,
  type CoreConfig,
  type TenantScope,
} from '../src/index.js';
import { startMongo } from './mongo.js';
import { TEST_CORE_CONFIG } from './core-config.js';

describe('sanitizeDoc', () => {
  it('keeps allowed structure and drops anything else', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 9, provenance: 'source_grounded', onclick: 'x' },
          content: [{ type: 'text', text: 'Title' }],
        },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bad link',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: 'good',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'evil' }],
            },
            {
              type: 'text',
              text: '[1]',
              marks: [{ type: 'citation', attrs: { label: 'S1', index: 1 } }],
            },
          ],
        },
      ],
    })!;
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]!.attrs).toEqual({ level: 4, provenance: 'source_grounded' });
    const para = doc.content![1]!.content!;
    expect(para[0]!.marks).toBeUndefined();
    expect(para[1]!.marks).toEqual([{ type: 'link', attrs: { href: 'https://example.com' } }]);
    expect(para[2]!.marks).toEqual([{ type: 'citation', attrs: { label: 'S1', index: 1 } }]);
  });
});

describe('notesToDoc', () => {
  it('numbers citations by first appearance and builds tables and lists', () => {
    const out: NotesOutput = {
      title: 't',
      learningObjectives: ['Explain X'],
      sections: [
        {
          type: 'concept',
          heading: 'Core',
          provenance: 'source_grounded',
          blocks: [
            {
              kind: 'paragraph',
              text: 'Fact one.',
              items: [],
              language: '',
              rows: [],
              citations: ['S3'],
            },
            {
              kind: 'paragraph',
              text: 'Fact two.',
              items: [],
              language: '',
              rows: [],
              citations: ['S1', 'S3'],
            },
            {
              kind: 'table',
              text: '',
              items: [],
              language: '',
              rows: [
                ['A', 'B'],
                ['1', '2'],
              ],
              citations: [],
            },
          ],
        },
      ],
      glossary: [],
      insufficientSources: false,
      missingTopics: [],
    };
    const order: string[] = [];
    const doc = notesToDoc(out, (l) =>
      order.includes(l) ? order.indexOf(l) + 1 : (order.push(l), order.length),
    );
    const json = JSON.stringify(doc);
    expect(order).toEqual(['S3', 'S1']);
    expect(json).toContain('"label":"S3","index":1');
    expect(json).toContain('"label":"S1","index":2');
    expect(json).toContain('"tableHeader"');
    expect(doc.content![0]).toMatchObject({
      type: 'heading',
      content: [{ text: 'Learning objectives' }],
    });
  });
});

/* ───────────── lifecycle integration ───────────── */

const author: Actor = { userId: 'a'.repeat(24), roles: ['content_manager'] };
const reviewer: Actor = { userId: 'b'.repeat(24), roles: ['academic_reviewer'] };
const ALL: TenantScope = { kind: 'all' };
let close: () => Promise<void>;
let content: ContentService;
let queue: JobQueue;
let courseId = '';
let topicId = '';
let otherInstitutionId = '';
let appHandle: Awaited<ReturnType<typeof boot>>['app'];

async function boot(config: CoreConfig) {
  const m = await startMongo();
  const mod = await Test.createTestingModule({
    imports: [MongooseModule.forRoot(m.uri), ServerCoreModule.forRoot(config)],
  }).compile();
  const app = mod.createNestApplication();
  await app.init();
  return {
    app,
    stop: async () => {
      await app.get(JobQueue).drain();
      await app.close();
      await m.stop();
    },
  };
}

beforeAll(async () => {
  const { app, stop } = await boot(TEST_CORE_CONFIG);
  close = stop;
  content = app.get(ContentService);
  queue = app.get(JobQueue);
  appHandle = app;
  const institutions = app.get(InstitutionsService);
  const academic = app.get(AcademicStructureService);
  const sources = app.get(SourceDocumentsService);
  const mk = async (slug: string) => {
    const inst = await institutions.create(
      author,
      CreateInstitutionSchema.parse({ name: slug, shortName: slug.toUpperCase(), slug }),
    );
    const id = String(inst._id);
    const fac = await academic.createFaculty(author, ALL, id, { name: 'Tech' });
    const dept = await academic.createDepartment(author, ALL, id, {
      facultyId: String(fac._id),
      name: 'CS',
      code: 'CS',
    });
    const prog = await academic.createProgramme(author, ALL, id, {
      departmentId: String(dept._id),
      name: 'ND CS',
      award: 'ND',
      code: 'ND',
      durationLevels: 2,
    });
    const lvl = await academic.createLevel(author, ALL, String(prog._id), {
      name: 'ND 1',
      code: 'ND1',
      rank: 1,
    });
    const sem = await academic.createSemester(author, ALL, id, {
      name: 'First',
      code: 'S1',
      rank: 1,
    });
    return { id, prog, lvl, sem };
  };
  const a = await mk('content-a');
  const b = await mk('content-b');
  otherInstitutionId = b.id;
  const course = await app.get(CoursesService).create(
    author,
    ALL,
    CreateCourseSchema.parse({
      programmeId: String(a.prog._id),
      levelId: String(a.lvl._id),
      semesterId: String(a.sem._id),
      code: 'COM 001',
      title: 'Intro to CS',
      creditUnits: 3,
    }),
  );
  courseId = String(course._id);
  const topic = await app
    .get(TopicsService)
    .create(author, ALL, courseId, { title: 'Computer Generations', learningObjectives: [] });
  await app.get(TopicsService).create(author, ALL, courseId, {
    title: 'First generation',
    parentTopicId: String(topic._id),
    learningObjectives: [],
  });
  topicId = String(topic._id);

  const upload = async (inst: string, text: string, title: string, approve: boolean) => {
    const { doc } = await sources.upload(
      author,
      ALL,
      inst,
      { buffer: Buffer.from(text), originalName: `${title}.txt` },
      { title, category: 'lecture_notes', licenceType: 'institution_owned' },
    );
    await queue.drain();
    if (approve) await sources.setApproval(reviewer, ALL, String(doc._id), true);
  };
  await upload(
    a.id,
    'Computer generations describe stages of computer technology. The first generation of computers used vacuum tubes. '.repeat(
      20,
    ),
    'Generations notes',
    true,
  );
  await upload(
    a.id,
    'UNAPPROVED: computer generations secret draft about vacuum tubes and transistors. '.repeat(20),
    'Unapproved draft',
    false,
  );
  await upload(
    b.id,
    'OTHER INSTITUTION: computer generations and vacuum tubes notes. '.repeat(20),
    'Other institution notes',
    true,
  );
});
afterAll(async () => close());

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const options = GenerationOptionsSchema.parse({});

describe('content lifecycle', () => {
  let versionId = '';
  let materialId = '';

  it('generates a draft grounded only in approved sources from the same institution', async () => {
    const r = await content.startGeneration(author, ALL, courseId, {
      topicIds: [topicId],
      kinds: ['notes_comprehensive'],
      options,
    });
    expect(r.jobs).toHaveLength(1);
    ({ versionId, materialId } = r.jobs[0]!);
    const again = await content.startGeneration(author, ALL, courseId, {
      topicIds: [topicId],
      kinds: ['notes_comprehensive'],
      options,
    });
    expect(again.jobs[0]!.deduplicated || again.jobs[0]!.versionId !== versionId).toBe(true);
    await queue.drain();
    const v = await content.getVersion(ALL, versionId);
    expect(v).toMatchObject({
      generationStatus: 'generated',
      reviewStatus: 'draft',
      frozen: false,
      origin: 'ai_generated',
    });
    expect(v.generation).toMatchObject({ provider: 'fake', taskKey: 'notes.comprehensive' });
    expect(v.provenance.citations.length).toBeGreaterThan(0);
    expect(v.provenance.citations.every((c) => c.sourceTitle === 'Generations notes')).toBe(true);
    expect(v.provenance.warnings.join(' ')).toMatch(/Development placeholder/);
    const json = JSON.stringify(v.body);
    expect(json).not.toMatch(/UNAPPROVED|OTHER INSTITUTION/);
    expect(json).toContain('First generation'); // subtopics become sections
    const [mat] = (await content.listForTopic(ALL, topicId)).filter(
      (m) => m.kind === 'notes_comprehensive',
    );
    expect(mat!.displayStatus).toBe('draft');
  });

  it('autosaves with optimistic concurrency', async () => {
    const v = await content.getVersion(ALL, versionId);
    const body = {
      kind: 'notes' as const,
      doc: {
        type: 'doc' as const,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Edited by a lecturer.' }] },
        ],
      },
      wordCount: 0,
      readingMinutes: 0,
    };
    const saved = await content.updateDraft(author, ALL, versionId, {
      autosaveRev: v.autosaveRev,
      body,
    });
    expect(saved.autosaveRev).toBe(v.autosaveRev + 1);
    expect(saved.body).toMatchObject({ kind: 'notes', wordCount: 4 });
    await expectCode(
      content.updateDraft(author, ALL, versionId, { autosaveRev: v.autosaveRev, body }),
      'PRECONDITION_FAILED',
    );
  });

  it('freezes on submit and blocks self-review', async () => {
    const submitted = await content.submit(author, ALL, versionId);
    expect(submitted).toMatchObject({ reviewStatus: 'in_review', frozen: true });
    const body = {
      kind: 'notes' as const,
      doc: { type: 'doc' as const, content: [] },
      wordCount: 0,
      readingMinutes: 0,
    };
    await expectCode(
      content.updateDraft(author, ALL, versionId, { autosaveRev: submitted.autosaveRev, body }),
      'VERSION_FROZEN',
    );
    const checklist = {
      accuracy: true,
      objectivesCovered: true,
      citationsChecked: true,
      appropriateLevel: true,
    };
    await expectCode(
      content.review(author, ALL, versionId, { decision: 'approved', comment: '', checklist }),
      'SELF_APPROVAL_FORBIDDEN',
    );
    const queueItems = await content.reviewQueue(ALL);
    expect(queueItems.map((q) => q.versionId)).toContain(versionId);
  });

  it('another reviewer approves; edits then happen on a new version', async () => {
    const checklist = {
      accuracy: true,
      objectivesCovered: true,
      citationsChecked: true,
      appropriateLevel: true,
    };
    const approved = await content.review(reviewer, ALL, versionId, {
      decision: 'approved',
      comment: 'Accurate',
      checklist,
    });
    expect(approved.reviewStatus).toBe('approved');
    expect(approved.reviews[0]).toMatchObject({ decision: 'approved', comment: 'Accurate' });
    let [mat] = (await content.listForTopic(ALL, topicId)).filter((m) => m.id === materialId);
    expect(mat).toMatchObject({
      displayStatus: 'approved',
      latestApprovedVersionId: versionId,
      currentDraftVersionId: null,
    });

    const fork = await content.fork(author, ALL, versionId);
    expect(fork).toMatchObject({
      reviewStatus: 'draft',
      frozen: false,
      parentVersionId: versionId,
      origin: 'ai_assisted_edit',
    });
    await expectCode(content.fork(author, ALL, versionId), 'CONFLICT'); // only one open draft at a time
    [mat] = (await content.listForTopic(ALL, topicId)).filter((m) => m.id === materialId);
    expect(mat).toMatchObject({
      displayStatus: 'draft',
      latestApprovedVersionId: versionId,
      currentDraftVersionId: fork.id,
    });
    expect((await content.getVersion(ALL, versionId)).frozen).toBe(true); // the approved version is untouched
  });

  it('changes requested need an explanation and can be withdrawn only before a decision', async () => {
    const r = await content.startGeneration(author, ALL, courseId, {
      topicIds: [topicId],
      kinds: ['revision_pack'],
      options,
    });
    await queue.drain();
    const id = r.jobs[0]!.versionId;
    const v = await content.getVersion(ALL, id);
    expect(v.body).toMatchObject({ kind: 'revision_pack' });
    await content.submit(author, ALL, id);
    await expectCode(content.withdraw(reviewer, ALL, id), 'FORBIDDEN');
    const back = await content.withdraw(author, ALL, id);
    expect(back).toMatchObject({ reviewStatus: 'draft', frozen: false });
  });

  it('respects institution scope', async () => {
    const scopeB: TenantScope = { kind: 'institutions', institutionIds: [otherInstitutionId] };
    await expectCode(content.getVersion(scopeB, versionId), 'NOT_FOUND');
    await expectCode(
      content.startGeneration(author, scopeB, courseId, {
        topicIds: [topicId],
        kinds: ['notes_simplified'],
        options,
      }),
      'NOT_FOUND',
    );
    expect(await content.reviewQueue(scopeB)).toEqual([]);
  });
});

describe('model output clean-up', () => {
  it('removes leaked provenance labels and inline citation tags', async () => {
    const { cleanModelText, stripTopicNumbering } = await import('../src/index.js');
    expect(cleanModelText('source_grounded: Generations are defined by technology. ["S1"]')).toBe(
      'Generations are defined by technology.',
    );
    expect(cleanModelText('Transistors replaced valves [S2, S3] in the 1950s (S4).')).toBe(
      'Transistors replaced valves in the 1950s.',
    );
    expect(cleanModelText('A normal sentence with [brackets] kept.')).toBe(
      'A normal sentence with [brackets] kept.',
    );
    expect(stripTopicNumbering('Week 2: Generations of computers')).toBe(
      'Generations of computers',
    );
    expect(stripTopicNumbering('2.1 First generation (vacuum tubes)')).toBe(
      'First generation (vacuum tubes)',
    );
    expect(stripTopicNumbering('IV. Software')).toBe('Software');
    expect(stripTopicNumbering('Computer hardware')).toBe('Computer hardware');
  });
});

/* ───────────── Phase 3b ───────────── */
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  EditorActionsService,
  MODELS as M,
  QuestionsService,
  UsageService,
  similarity,
  validateQuestion,
} from '../src/index.js';

describe('question rules', () => {
  it('validates each question type', () => {
    const opt = (text: string, isCorrect = false) => ({ id: text, text, isCorrect });
    expect(
      validateQuestion({
        type: 'mcq_single',
        stem: 'Which device stores data?',
        options: [opt('Disk', true), opt('Mouse'), opt('Monitor')],
        acceptedAnswers: [],
      }),
    ).toEqual([]);
    expect(
      validateQuestion({
        type: 'mcq_single',
        stem: 'Which device stores data?',
        options: [opt('Disk', true), opt('Disk', true), opt('Monitor')],
        acceptedAnswers: [],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateQuestion({
        type: 'fill_gap',
        stem: 'A CPU has no blank here',
        options: [],
        acceptedAnswers: ['x'],
      })[0],
    ).toMatch(/blank/);
    expect(
      validateQuestion({
        type: 'short_answer',
        stem: 'Explain caching briefly.',
        options: [],
        acceptedAnswers: [],
      })[0],
    ).toMatch(/key points/);
    expect(
      similarity('What is the function of the CPU?', 'What is the main function of the CPU?'),
    ).toBeGreaterThan(0.6);
  });
});

describe('quizzes', () => {
  let approvedNotesId = '';
  let questionIds: string[] = [];
  let unapprovedId = '';

  it('generates questions only from approved notes, flags duplicates', async () => {
    const qs = appHandle.get(QuestionsService);
    // the approved notes from the lifecycle tests
    const mats = await content.listForTopic(ALL, topicId);
    approvedNotesId = mats.find((m) => m.kind === 'notes_comprehensive')!.latestApprovedVersionId!;
    const draftId = mats.find((m) => m.kind === 'notes_comprehensive')!.currentDraftVersionId!;
    await expectCode(
      qs.startGeneration(author, ALL, draftId, {
        count: 4,
        types: ['mcq_single'],
        difficulty: 'mixed',
      }),
      'CONTENT_NOT_APPROVED',
    );
    await qs.startGeneration(author, ALL, approvedNotesId, {
      count: 4,
      types: ['mcq_single', 'true_false'],
      difficulty: 'mixed',
    });
    await queue.drain();
    let list = await qs.list(ALL, { page: 1, pageSize: 50, topicId });
    expect(list.total).toBe(4);
    expect(list.items.every((q) => q.reviewStatus === 'draft' && q.origin === 'ai_generated')).toBe(
      true,
    );
    // same request again → same stems → flagged as duplicates (never deleted)
    await qs.startGeneration(author, ALL, approvedNotesId, {
      count: 2,
      types: ['mcq_single'],
      difficulty: 'easy',
    });
    await queue.drain();
    list = await qs.list(ALL, { page: 1, pageSize: 50, topicId });
    expect(list.items.filter((q) => q.duplicateOf).length).toBeGreaterThanOrEqual(1);
    questionIds = list.items.filter((q) => !q.duplicateOf).map((q) => String(q._id));
    unapprovedId = String(list.items.find((q) => q.duplicateOf)!._id);
    expect(questionIds.length).toBeGreaterThanOrEqual(2);
  });

  it('enforces separation of duties and revises approved questions instead of editing them', async () => {
    const qs = appHandle.get(QuestionsService);
    await expectCode(
      qs.review(author, ALL, questionIds[0]!, { decision: 'approved', comment: '' }),
      'SELF_APPROVAL_FORBIDDEN',
    );
    const approved = await qs.review(reviewer, ALL, questionIds[0]!, {
      decision: 'approved',
      comment: '',
    });
    expect(approved.reviewStatus).toBe('approved');
    const revised = await qs.update(author, ALL, questionIds[0]!, {
      stem: 'Revised: which option is correct?',
      options: approved.options,
      acceptedAnswers: [],
      explanation: 'x',
      difficulty: 'easy',
    });
    expect(revised).toMatchObject({ revision: 2, reviewStatus: 'draft', isLatest: true });
    expect((await qs.get(ALL, questionIds[0]!)).isLatest).toBe(false);
    await qs.review(reviewer, ALL, questionIds[1]!, { decision: 'approved', comment: '' });
  });

  it('composes quizzes from approved questions only, pinning revisions', async () => {
    const qs = appHandle.get(QuestionsService);
    await expectCode(
      qs.composeQuiz(author, ALL, topicId, {
        questionIds: [unapprovedId],
        settings: { shuffle: true, timeLimitMinutes: null, passMarkPercent: 50 },
      }),
      'CONTENT_NOT_APPROVED',
    );
    const quiz = await qs.composeQuiz(author, ALL, topicId, {
      questionIds: [questionIds[0]!, questionIds[1]!],
      settings: { shuffle: false, timeLimitMinutes: 20, passMarkPercent: 60 },
    });
    expect(quiz.body).toMatchObject({ kind: 'quiz', settings: { passMarkPercent: 60 } });
    expect(
      (quiz.body as { questionRefs: { revision: number }[] }).questionRefs.map((r) => r.revision),
    ).toEqual([1, 1]);
    expect((await qs.quizQuestions(ALL, quiz.id)).map((q) => String(q._id))).toEqual([
      questionIds[0],
      questionIds[1],
    ]);
    // only reorder/remove/settings on the draft
    await expectCode(
      content.updateDraft(author, ALL, quiz.id, {
        autosaveRev: quiz.autosaveRev,
        body: {
          kind: 'quiz',
          questionRefs: [{ questionId: unapprovedId, lineageId: unapprovedId, revision: 1 }],
          settings: { shuffle: true, timeLimitMinutes: null, passMarkPercent: 50 },
        },
      }),
      'VALIDATION_FAILED',
    );
    const reordered = await content.updateDraft(author, ALL, quiz.id, {
      autosaveRev: quiz.autosaveRev,
      body: {
        ...(quiz.body as { kind: 'quiz'; questionRefs: never[]; settings: never }),
        questionRefs: [...(quiz.body as { questionRefs: never[] }).questionRefs].reverse(),
      },
    });
    expect(
      (reordered.body as { questionRefs: { questionId: string }[] }).questionRefs[0]!.questionId,
    ).toBe(questionIds[1]);
    expect((await content.submit(author, ALL, quiz.id)).reviewStatus).toBe('in_review');
  });
});

describe('editor actions', () => {
  it('suggests (never applies) changes on drafts only', async () => {
    const svc = appHandle.get(EditorActionsService);
    const mats = await content.listForTopic(ALL, topicId);
    const notes = mats.find((m) => m.kind === 'notes_comprehensive')!;
    const r = await svc.suggest(author, ALL, notes.currentDraftVersionId!, {
      action: 'simplify',
      text: 'Transistors replaced vacuum tubes.',
      context: '',
    });
    expect(r).toMatchObject({
      provider: 'fake',
      suggestion: '[Development placeholder: simplify] Transistors replaced vacuum tubes.',
    });
    await expectCode(
      svc.suggest(author, ALL, notes.latestApprovedVersionId!, {
        action: 'grammar',
        text: 'Some text here',
        context: '',
      }),
      'VERSION_FROZEN',
    );
  });
});

describe('usage and budgets', () => {
  it('summarises the ledger and blocks new AI work once the monthly budget is used', async () => {
    const usage = appHandle.get(UsageService);
    const ledger = appHandle.get(getModelToken(M.AiUsage));
    const course = await appHandle.get(CoursesService).load(ALL, courseId);
    await ledger.create([
      {
        institutionId: course.institutionId,
        capability: 'text',
        taskKey: 'notes.comprehensive',
        provider: 'openai',
        model: 'fake-placeholder-v1',
        inputTokens: 1000,
        outputTokens: 500,
        status: 'ok',
      },
      {
        institutionId: course.institutionId,
        capability: 'text',
        taskKey: 'quiz.generate',
        provider: 'openai',
        model: 'fake-placeholder-v1',
        inputTokens: 0,
        outputTokens: 0,
        status: 'error',
        errorCode: 'X',
      },
    ]);
    const s = await usage.summary(ALL, { institutionId: String(course.institutionId) });
    expect(s.totals).toMatchObject({
      calls: 2,
      inputTokens: 1000,
      outputTokens: 500,
      errors: 1,
      estimatedUsd: 2,
    }); // (1000×1000 + 500×2000) / 1M
    expect(s.byTask.map((r) => r.key)).toEqual(['notes.comprehensive', 'quiz.generate']);
    const scopeB: TenantScope = { kind: 'institutions', institutionIds: [otherInstitutionId] };
    expect((await usage.summary(scopeB, {})).totals.calls).toBe(0);

    await appHandle
      .get(getModelToken(M.Institution))
      .updateOne({ _id: course.institutionId }, { $set: { 'settings.aiMonthlyBudgetUsd': 1 } });
    await expectCode(
      content.startGeneration(author, ALL, courseId, {
        topicIds: [topicId],
        kinds: ['notes_simplified'],
        options,
      }),
      'BUDGET_EXCEEDED',
    );
    await appHandle
      .get(getModelToken(M.Institution))
      .updateOne({ _id: course.institutionId }, { $set: { 'settings.aiMonthlyBudgetUsd': 0 } });
    void Types;
  });
});

describe('job summaries', () => {
  it('keeps the processor summary message after completion', async () => {
    const jobs = await appHandle
      .get(getModelToken(M.GenerationJob))
      .find({ type: 'quiz_generation', status: 'completed' })
      .setOptions({ crossTenant: true })
      .lean();
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].progress).toMatchObject({
      pct: 100,
      stage: 'done',
      message: expect.stringMatching(/^Created \d+ question/),
    });
  });
});

// Runs last: it boots and stops a second app, which disconnects the shared mongoose client.
describe('without a text provider', () => {
  it('fails the generation clearly instead of inventing content', async () => {
    const { app, stop } = await boot({
      ...TEST_CORE_CONFIG,
      ai: { ...TEST_CORE_CONFIG.ai, textProvider: 'none' },
    });
    try {
      const inst = await app
        .get(InstitutionsService)
        .create(
          author,
          CreateInstitutionSchema.parse({ name: 'NoAI', shortName: 'NA', slug: 'no-ai' }),
        );
      const id = String(inst._id);
      const academic = app.get(AcademicStructureService);
      const fac = await academic.createFaculty(author, ALL, id, { name: 'F' });
      const dept = await academic.createDepartment(author, ALL, id, {
        facultyId: String(fac._id),
        name: 'D',
        code: 'D',
      });
      const prog = await academic.createProgramme(author, ALL, id, {
        departmentId: String(dept._id),
        name: 'P',
        award: 'ND',
        code: 'P',
        durationLevels: 2,
      });
      const lvl = await academic.createLevel(author, ALL, String(prog._id), {
        name: 'L1',
        code: 'L1',
        rank: 1,
      });
      const sem = await academic.createSemester(author, ALL, id, { name: 'S', code: 'S', rank: 1 });
      const c = await app.get(CoursesService).create(
        author,
        ALL,
        CreateCourseSchema.parse({
          programmeId: String(prog._id),
          levelId: String(lvl._id),
          semesterId: String(sem._id),
          code: 'ABC 100',
          title: 'Course',
          creditUnits: 1,
        }),
      );
      const t = await app
        .get(TopicsService)
        .create(author, ALL, String(c._id), { title: 'Topic', learningObjectives: [] });
      const svc = app.get(ContentService);
      const r = await svc.startGeneration(author, ALL, String(c._id), {
        topicIds: [String(t._id)],
        kinds: ['notes_comprehensive'],
        options,
      });
      await app.get(JobQueue).drain();
      const v = await svc.getVersion(ALL, r.jobs[0]!.versionId);
      expect(v.generationStatus).toBe('failed');
      expect(v.generation?.error).toMatch(/No AI text provider/);
      expect(v.body).toBeNull();
    } finally {
      await stop();
    }
  });
});
