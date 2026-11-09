import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import {
  CreateCourseSchema,
  CreateInstitutionSchema,
  GenerationOptionsSchema,
} from '@cslp/validation';
import {
  AcademicStructureService,
  AppError,
  ContentService,
  CoursesService,
  InstitutionsService,
  JobQueue,
  MODELS,
  PublishedContentService,
  PublishingService,
  QuestionsService,
  ServerCoreModule,
  TopicsService,
  InsightsService,
  LearningService,
  gradeAnswer,
  normaliseAnswer,
  type Actor,
  type QuestionDoc,
  type TenantScope,
  type UserDoc,
} from '../src/index.js';
import { startMongo } from './mongo.js';
import { TEST_CORE_CONFIG } from './core-config.js';

const author: Actor = { userId: 'a'.repeat(24), roles: ['content_manager'] };
const reviewer: Actor = { userId: 'b'.repeat(24), roles: ['academic_reviewer'] };
const publisher: Actor = { userId: 'c'.repeat(24), roles: ['institution_admin'] };
const ALL: TenantScope = { kind: 'all' };
const checklist = {
  accuracy: true,
  objectivesCovered: true,
  citationsChecked: true,
  appropriateLevel: true,
};
const options = GenerationOptionsSchema.parse({});

let stop: () => Promise<void>;
let content: ContentService;
let publishing: PublishingService;
let published: PublishedContentService;
let queue: JobQueue;
let topicsSvc: TopicsService;
let questions: QuestionsService;
let instA: Types.ObjectId;
let instB: Types.ObjectId;
let courseId = '';
let topicId = '';
let subtopicId = '';
let notesMaterialId = '';
let v1 = '';
let quizMaterialId = '';
let appRef: { get: <T>(t: unknown) => T };

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const docText = (m: { content: { kind: string; doc?: unknown } }) => JSON.stringify(m.content);

async function approvedNotes(
  topic: string,
  kind: 'notes_comprehensive' | 'revision_pack' = 'notes_comprehensive',
) {
  const r = await content.startGeneration(author, ALL, courseId, {
    topicIds: [topic],
    kinds: [kind],
    options,
  });
  await queue.drain();
  const id = r.jobs[0]!.versionId;
  await content.submit(author, ALL, id);
  await content.review(reviewer, ALL, id, { decision: 'approved', comment: '', checklist });
  return { versionId: id, materialId: r.jobs[0]!.materialId };
}

beforeAll(async () => {
  const m = await startMongo();
  const mod = await Test.createTestingModule({
    imports: [MongooseModule.forRoot(m.uri), ServerCoreModule.forRoot(TEST_CORE_CONFIG)],
  }).compile();
  const app = mod.createNestApplication();
  await app.init();
  appRef = app as never;
  content = app.get(ContentService);
  publishing = app.get(PublishingService);
  published = app.get(PublishedContentService);
  queue = app.get(JobQueue);
  topicsSvc = app.get(TopicsService);
  questions = app.get(QuestionsService);
  stop = async () => {
    await queue.drain();
    await app.close();
    await m.stop();
  };
  const academic = app.get(AcademicStructureService);
  const mk = async (slug: string) => {
    const inst = await app
      .get(InstitutionsService)
      .create(
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
    return { inst, prog, lvl, sem };
  };
  const a = await mk('pub-a');
  const b = await mk('pub-b');
  instA = a.inst._id;
  instB = b.inst._id;
  const c = await app.get(CoursesService).create(
    author,
    ALL,
    CreateCourseSchema.parse({
      programmeId: String(a.prog._id),
      levelId: String(a.lvl._id),
      semesterId: String(a.sem._id),
      code: 'COM 001',
      title: 'Intro',
      creditUnits: 3,
    }),
  );
  courseId = String(c._id);
  const t = await topicsSvc.create(author, ALL, courseId, {
    title: 'Computer Hardware',
    learningObjectives: [],
  });
  topicId = String(t._id);
  subtopicId = String(
    (
      await topicsSvc.create(author, ALL, courseId, {
        title: 'Input devices',
        parentTopicId: topicId,
        learningObjectives: [],
      })
    )._id,
  );
  ({ versionId: v1, materialId: notesMaterialId } = await approvedNotes(topicId));
});
afterAll(async () => stop());

describe('publishing rules', () => {
  it('refuses unapproved versions and courses without topics', async () => {
    const draft = await content.fork(author, ALL, v1);
    await expectCode(
      publishing.publish(publisher, ALL, notesMaterialId, draft.id),
      'CONTENT_NOT_APPROVED',
    );
    await expectCode(
      publishing.schedule(publisher, ALL, notesMaterialId, v1, new Date(Date.now() + 30_000)),
      'VALIDATION_FAILED',
    );
  });
});

describe('student visibility chain (docs/05 §6–7)', () => {
  it('shows content only when course, topic and material are all published', async () => {
    const see = () => published.material(instA, notesMaterialId);
    await expectCode(see(), 'NOT_FOUND');
    await publishing.publish(publisher, ALL, notesMaterialId, v1);
    await expectCode(see(), 'NOT_FOUND'); // course still unpublished
    expect((await published.listCourses(instA, { page: 1, pageSize: 25 })).total).toBe(0);
    await expectCode(published.courseDetail(instA, courseId), 'NOT_FOUND');

    await publishing.setCourse(publisher, ALL, courseId, true);
    await expectCode(see(), 'NOT_FOUND'); // topic still unpublished
    expect((await published.courseDetail(instA, courseId)).topics).toEqual([]);

    await publishing.setTopic(publisher, ALL, topicId, true);
    const m = await see();
    expect(m).toMatchObject({
      kind: 'notes_comprehensive',
      course: { code: 'COM 001' },
      topic: { title: 'Computer Hardware' },
      aiAssisted: true,
    });
    const detail = await published.courseDetail(instA, courseId);
    expect(detail.topics[0]!.materials.map((x) => x.id)).toEqual([notesMaterialId]);
    expect((await published.listCourses(instA, { page: 1, pageSize: 25 })).items[0]).toMatchObject({
      code: 'COM 001',
      topicCount: 1,
    });

    // Hiding the course hides everything under it; republishing restores it exactly.
    await publishing.setCourse(publisher, ALL, courseId, false);
    await expectCode(see(), 'NOT_FOUND');
    await publishing.setCourse(publisher, ALL, courseId, true);
    expect((await see()).id).toBe(notesMaterialId);
  });

  it('a subtopic is only visible when its parent topic is too', async () => {
    const sub = await approvedNotes(subtopicId, 'revision_pack');
    await publishing.publish(publisher, ALL, sub.materialId, sub.versionId);
    await publishing.setTopic(publisher, ALL, subtopicId, true);
    expect((await published.material(instA, sub.materialId)).content.kind).toBe('revision_pack');
    await publishing.setTopic(publisher, ALL, topicId, false);
    await expectCode(published.material(instA, sub.materialId), 'NOT_FOUND');
    await publishing.setTopic(publisher, ALL, topicId, true);
  });

  it('drafts never leak; new versions appear only when published; rollback is a pointer change', async () => {
    const mats = await content.listForTopic(ALL, topicId);
    const draftId = mats.find((x) => x.id === notesMaterialId)!.currentDraftVersionId!;
    const draft = await content.getVersion(ALL, draftId);
    await content.updateDraft(author, ALL, draftId, {
      autosaveRev: draft.autosaveRev,
      body: {
        kind: 'notes',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'SECRET DRAFT TEXT' }] }],
        },
        wordCount: 0,
        readingMinutes: 0,
      },
    });
    expect(docText(await published.material(instA, notesMaterialId))).not.toContain(
      'SECRET DRAFT TEXT',
    );
    await content.submit(author, ALL, draftId);
    await content.review(reviewer, ALL, draftId, { decision: 'approved', comment: '', checklist });
    expect(docText(await published.material(instA, notesMaterialId))).not.toContain(
      'SECRET DRAFT TEXT',
    ); // approved ≠ published
    await publishing.publish(publisher, ALL, notesMaterialId, draftId);
    expect(docText(await published.material(instA, notesMaterialId))).toContain(
      'SECRET DRAFT TEXT',
    );
    await publishing.rollback(publisher, ALL, notesMaterialId, v1, 'Reverting for checks');
    expect(docText(await published.material(instA, notesMaterialId))).not.toContain(
      'SECRET DRAFT TEXT',
    );
    const history = await publishing.history(ALL, { page: 1, pageSize: 50 });
    expect(history.items[0]).toMatchObject({
      action: 'rollback',
      fromVersionNumber: 2,
      toVersionNumber: 1,
      reason: 'Reverting for checks',
    });
  });

  it('unpublishing hides the material and is shown as unpublished', async () => {
    await publishing.unpublish(publisher, ALL, notesMaterialId, 'Temporary withdrawal');
    await expectCode(published.material(instA, notesMaterialId), 'NOT_FOUND');
    const [mat] = (await content.listForTopic(ALL, topicId)).filter(
      (x) => x.id === notesMaterialId,
    );
    expect(mat!.displayStatus).toBe('unpublished');
  });

  it('scheduled publishing happens when due, after re-checking approval', async () => {
    await publishing.schedule(
      publisher,
      ALL,
      notesMaterialId,
      v1,
      new Date(Date.now() + 10 * 60_000),
    );
    await expectCode(published.material(instA, notesMaterialId), 'NOT_FOUND');
    expect(await publishing.runDueSchedules(new Date())).toBe(0);
    expect(await publishing.runDueSchedules(new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect((await published.material(instA, notesMaterialId)).id).toBe(notesMaterialId);
  });

  it('never sends quiz answers to students', async () => {
    await questions.startGeneration(author, ALL, v1, {
      count: 3,
      types: ['mcq_single', 'fill_gap', 'short_answer'],
      difficulty: 'mixed',
    });
    await queue.drain();
    const list = await questions.list(ALL, { page: 1, pageSize: 50, topicId });
    const ids = list.items.map((q) => String(q._id));
    for (const id of ids)
      await questions.review(reviewer, ALL, id, { decision: 'approved', comment: '' });
    const quiz = await questions.composeQuiz(author, ALL, topicId, {
      questionIds: ids,
      settings: { shuffle: false, timeLimitMinutes: 15, passMarkPercent: 50 },
    });
    await content.submit(author, ALL, quiz.id);
    await content.review(reviewer, ALL, quiz.id, { decision: 'approved', comment: '', checklist });
    await publishing.publish(publisher, ALL, quiz.materialId, quiz.id);
    quizMaterialId = quiz.materialId;
    const m = await published.material(instA, quiz.materialId);
    expect(m.content.kind).toBe('quiz');
    const qz = m.content as { questions: { options: object[] }[] };
    expect(qz.questions.length).toBe(ids.length);
    expect(qz.questions.some((q) => q.options.length > 0)).toBe(true);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/isCorrect|acceptedAnswers|explanation|placeholder\b"/);
    expect(json).not.toContain('"answer"');
  });

  it('students from another institution see nothing', async () => {
    expect((await published.listCourses(instB, { page: 1, pageSize: 25 })).total).toBe(0);
    await expectCode(published.material(instB, notesMaterialId), 'NOT_FOUND');
    await expectCode(published.courseDetail(instB, courseId), 'NOT_FOUND');
  });
});

describe('bundles', () => {
  it('apply all-or-nothing', async () => {
    const t2 = await topicsSvc.create(author, ALL, courseId, {
      title: 'Software',
      learningObjectives: [],
    });
    const good = await approvedNotes(String(t2._id));
    const bad = await content.fork(author, ALL, good.versionId); // a draft → invalid in a bundle
    await expectCode(
      publishing.bundle(publisher, ALL, {
        courseId,
        items: [good, { materialId: good.materialId, versionId: bad.id }],
        publishCourse: true,
        topicIds: [String(t2._id)],
      }),
      'CONTENT_NOT_APPROVED',
    );
    await expectCode(published.material(instA, good.materialId), 'NOT_FOUND');
    expect(
      (await published.courseDetail(instA, courseId)).topics.map((t) => t.title),
    ).not.toContain('Software');
    const r = await publishing.bundle(publisher, ALL, {
      courseId,
      items: [good],
      publishCourse: true,
      topicIds: [String(t2._id)],
    });
    expect(r.published).toBe(1);
    expect((await published.material(instA, good.materialId)).topic.title).toBe('Software');
  });
});

describe('preview as student', () => {
  it('renders any version with the student serializer', async () => {
    const p = await published.preview(ALL, v1);
    expect(p).toMatchObject({ id: notesMaterialId, content: { kind: 'notes' } });
    expect(JSON.stringify(p)).not.toMatch(/reviewStatus|generation|autosaveRev|chunkId/);
  });
});

describe('grading rules', () => {
  const mcq = {
    type: 'mcq_single' as const,
    options: [
      { id: 'a', isCorrect: false },
      { id: 'b', isCorrect: true },
    ],
    acceptedAnswers: [],
  };
  it('grades choice questions by the correct option', () => {
    expect(gradeAnswer(mcq, { optionId: 'b' })).toEqual({ outcome: 'correct', scored: true });
    expect(gradeAnswer(mcq, { optionId: 'a' })).toEqual({ outcome: 'incorrect', scored: true });
    expect(gradeAnswer(mcq, undefined)).toEqual({ outcome: 'unanswered', scored: true });
  });
  it('normalises gap answers and leaves unmatched short answers for review', () => {
    const gap = {
      type: 'fill_gap' as const,
      options: [],
      acceptedAnswers: ['Central Processing Unit'],
    };
    expect(gradeAnswer(gap, { text: '  central   processing unit. ' }).outcome).toBe('correct');
    expect(gradeAnswer(gap, { text: 'GPU' }).outcome).toBe('incorrect');
    const sa = { type: 'short_answer' as const, options: [], acceptedAnswers: [] };
    expect(gradeAnswer(sa, { text: 'An essay' })).toEqual({
      outcome: 'needs_review',
      scored: false,
    });
    expect(normaliseAnswer('“RAM”')).toBe('ram');
  });
});

describe('student learning and insights', () => {
  let learning: LearningService;
  let insights: InsightsService;
  let studentA = '';
  let studentB = '';

  beforeAll(async () => {
    learning = appRef.get(LearningService);
    insights = appRef.get(InsightsService);
    const users = appRef.get<Model<UserDoc>>(getModelToken(MODELS.User));
    const mk = async (email: string, inst: Types.ObjectId) =>
      String(
        (
          await users.create({
            email,
            passwordHash: null,
            accountType: 'student',
            status: 'active',
            emailVerifiedAt: new Date(),
            profile: { firstName: 'Stu', lastName: 'Dent' },
            studentProfile: { institutionId: inst, programmeId: null, levelId: null },
          })
        )._id,
      );
    studentA = await mk('learner.a@test.dev', instA);
    studentB = await mk('learner.b@test.dev', instB);
  });

  it('grades quiz attempts server-side from the pinned revisions and records progress', async () => {
    expect(quizMaterialId).not.toBe('');
    const shown = await published.material(instA, quizMaterialId);
    const ids = (shown.content as { questions: { id: string }[] }).questions.map((q) => q.id);
    const qModel = appRef.get<Model<QuestionDoc>>(getModelToken(MODELS.Question));
    const full = await qModel
      .find({ institutionId: instA, _id: { $in: ids } })
      .lean<QuestionDoc[]>();
    const right = full.map((q) => ({
      questionId: String(q._id),
      optionId: q.options.find((o) => o.isCorrect)?.id,
      text: q.acceptedAnswers[0],
    }));
    const r = await learning.submitAttempt(studentA, instA, quizMaterialId, { answers: right });
    const scoredCount = full.filter(
      (q) => q.type !== 'short_answer' || q.acceptedAnswers.length,
    ).length;
    expect(r.maxScore).toBe(scoredCount);
    expect(r.score).toBe(r.maxScore);
    expect(r.passed).toBe(true);
    expect(r.results).toHaveLength(full.length);

    const wrong = await learning.submitAttempt(studentA, instA, quizMaterialId, { answers: [] });
    expect(wrong.score).toBe(0);
    expect(wrong.results.every((x) => x.outcome === 'unanswered')).toBe(true);
    expect(await learning.listAttempts(studentA, instA, quizMaterialId)).toHaveLength(2);

    const prog = await learning.listProgress(studentA, instA);
    expect(prog.find((p) => p.materialId === quizMaterialId)).toMatchObject({
      state: 'completed',
      percent: 100,
    });
    const enrol = await learning.listEnrolments(studentA, instA);
    expect(enrol[0]).toMatchObject({ courseId, progress: { completedMaterials: 1 } });
  });

  it('progress only moves forward and needs visible content', async () => {
    await learning.updateProgress(studentA, instA, notesMaterialId, {
      state: 'in_progress',
      percent: 40,
      timeSpentSec: 30,
    });
    const p = await learning.updateProgress(studentA, instA, notesMaterialId, {
      state: 'in_progress',
      percent: 10,
      timeSpentSec: 30,
    });
    expect(p).toMatchObject({ state: 'in_progress', percent: 40, timeSpentSec: 60 });
    await expectCode(
      learning.updateProgress(studentB, instB, notesMaterialId, {
        state: 'completed',
        timeSpentSec: 0,
      }),
      'NOT_FOUND',
    );
    await expectCode(
      learning.submitAttempt(studentB, instB, quizMaterialId, { answers: [] }),
      'NOT_FOUND',
    );
    await expectCode(
      learning.submitAttempt(studentA, instA, notesMaterialId, { answers: [] }),
      'CONFLICT',
    );
  });

  it('dashboard and engagement reflect real activity, scoped by institution', async () => {
    const all = await insights.overview(ALL);
    expect(all.counts).toMatchObject({
      institutions: 2,
      registeredStudents: 2,
      activeStudents30d: 1,
    });
    expect(all.counts.publishedLessons).toBeGreaterThan(0);
    const scopedB = await insights.overview({
      kind: 'institutions',
      institutionIds: [String(instB)],
    });
    expect(scopedB.counts).toMatchObject({
      institutions: 1,
      courses: 0,
      registeredStudents: 1,
      activeStudents30d: 0,
    });
    const e = await insights.engagement(ALL, { institutionId: String(instA) });
    expect(e).toMatchObject({
      enrolments: 1,
      activeLearners30d: 1,
      quizAttempts: 2,
      averageQuizPercent: 50,
    });
    expect(e.courses[0]).toMatchObject({ courseId, enrolments: 1 });
    await expectCode(
      insights.engagement(
        { kind: 'institutions', institutionIds: [String(instB)] },
        { institutionId: String(instA) },
      ),
      'NOT_FOUND',
    );
  });

  it('lists and suspends students within scope only', async () => {
    const scopeA: TenantScope = { kind: 'institutions', institutionIds: [String(instA)] };
    const list = await insights.listStudents(scopeA, { page: 1, pageSize: 25 });
    expect(list.items.map((s) => s.email)).toEqual(['learner.a@test.dev']);
    expect(list.items[0]).toMatchObject({ enrolments: 1, emailVerified: true });
    const s = await insights.setStudentStatus(scopeA, publisher, studentA, 'suspended', 'Test');
    expect(s.status).toBe('suspended');
    await expectCode(
      insights.setStudentStatus(scopeA, publisher, studentB, 'suspended'),
      'NOT_FOUND',
    );
    expect((await insights.setStudentStatus(scopeA, publisher, studentA, 'active')).status).toBe(
      'active',
    );
  });
});

export { getModelToken, MODELS, QuestionsService };
