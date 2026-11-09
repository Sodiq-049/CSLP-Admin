import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CreateCourseSchema, CreateInstitutionSchema } from '@cslp/validation';
import {
  AcademicStructureService,
  AppError,
  CoursesService,
  InstitutionsService,
  JobQueue,
  MODELS,
  OutlinesService,
  ServerCoreModule,
  SourceDocumentsService,
  TopicsService,
  type Actor,
  type DocumentChunkDoc,
  type TenantScope,
} from '../src/index.js';
import { startMongo } from './mongo.js';
import { TEST_CORE_CONFIG } from './core-config.js';
import { makeDocx, SAMPLE_OUTLINE } from './fixtures/make.js';

const actor: Actor = { userId: null, roles: ['test'] };
const ALL: TenantScope = { kind: 'all' };

let close: () => Promise<void>;
let academic: AcademicStructureService;
let courses: CoursesService;
let topics: TopicsService;
let outlines: OutlinesService;
let sources: SourceDocumentsService;
let queue: JobQueue;
let chunkModel: Model<DocumentChunkDoc>;

interface Placement {
  institutionId: string;
  programmeId: string;
  levelId: string;
  semesterId: string;
  otherProgrammeId: string;
  otherLevelId: string;
}
const places: Record<string, Placement> = {};

async function setupInstitution(slug: string): Promise<Placement> {
  const inst = await app().institutions.create(
    actor,
    CreateInstitutionSchema.parse({ name: `Inst ${slug}`, shortName: slug.toUpperCase(), slug }),
  );
  const id = String(inst._id);
  const fac = await academic.createFaculty(actor, ALL, id, { name: 'Technology' });
  const dept = await academic.createDepartment(actor, ALL, id, {
    facultyId: String(fac._id),
    name: 'Computing',
    code: 'CMP',
  });
  const nd = await academic.createProgramme(actor, ALL, id, {
    departmentId: String(dept._id),
    name: 'ND',
    award: 'ND',
    code: 'ND',
    durationLevels: 2,
  });
  const hnd = await academic.createProgramme(actor, ALL, id, {
    departmentId: String(dept._id),
    name: 'HND',
    award: 'HND',
    code: 'HND',
    durationLevels: 2,
  });
  const l1 = await academic.createLevel(actor, ALL, String(nd._id), {
    name: 'ND 1',
    code: 'ND1',
    rank: 1,
  });
  const h1 = await academic.createLevel(actor, ALL, String(hnd._id), {
    name: 'HND 1',
    code: 'HND1',
    rank: 1,
  });
  const s1 = await academic.createSemester(actor, ALL, id, { name: 'First', code: 'S1', rank: 1 });
  return {
    institutionId: id,
    programmeId: String(nd._id),
    levelId: String(l1._id),
    semesterId: String(s1._id),
    otherProgrammeId: String(hnd._id),
    otherLevelId: String(h1._id),
  };
}

let appRef: { institutions: InstitutionsService };
const app = () => appRef;

beforeAll(async () => {
  const m = await startMongo();
  const mod = await Test.createTestingModule({
    imports: [MongooseModule.forRoot(m.uri), ServerCoreModule.forRoot(TEST_CORE_CONFIG)],
  }).compile();
  const nest = mod.createNestApplication();
  await nest.init();
  appRef = { institutions: nest.get(InstitutionsService) };
  academic = nest.get(AcademicStructureService);
  courses = nest.get(CoursesService);
  topics = nest.get(TopicsService);
  outlines = nest.get(OutlinesService);
  sources = nest.get(SourceDocumentsService);
  queue = nest.get(JobQueue);
  chunkModel = nest.get(getModelToken(MODELS.DocumentChunk));
  places.a = await setupInstitution('p2-a');
  places.b = await setupInstitution('p2-b');
  close = async () => {
    await queue.drain();
    await nest.close();
    await m.stop();
  };
});
afterAll(async () => close());

const expectCode = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
const course = (p: Placement, code: string, extra: object = {}) =>
  CreateCourseSchema.parse({
    programmeId: p.programmeId,
    levelId: p.levelId,
    semesterId: p.semesterId,
    code,
    title: 'Introduction to Computing',
    creditUnits: 3,
    ...extra,
  });

describe('courses', () => {
  it('creates draft courses with normalised codes and derived placement', async () => {
    const c = await courses.create(
      actor,
      ALL,
      course(places.a!, 'csc 101', { objectives: [{ text: 'Explain what a computer is' }] }),
    );
    expect(c.code).toBe('CSC 101');
    expect(c.codeNormalized).toBe('CSC101');
    expect(c.publication.state).toBe('unpublished');
    expect(c.objectives[0]!.source).toBe('official');
    const [dto] = await courses.toDtos([c]);
    expect(dto!.labels).toMatchObject({
      programme: 'ND',
      level: 'ND 1',
      semester: 'First',
      department: 'Computing',
    });
  });

  it('enforces code uniqueness per programme + curriculum, but allows reuse elsewhere', async () => {
    await expectCode(
      courses.create(actor, ALL, course(places.a!, 'CSC-101')),
      'DUPLICATE_COURSE_CODE',
    );
    // same code in another programme of the same institution
    await courses.create(
      actor,
      ALL,
      CreateCourseSchema.parse({
        programmeId: places.a!.otherProgrammeId,
        levelId: places.a!.otherLevelId,
        semesterId: places.a!.semesterId,
        code: 'CSC 101',
        title: 'HND Computing',
        creditUnits: 2,
      }),
    );
    // same code in another institution
    await courses.create(actor, ALL, course(places.b!, 'CSC 101'));
  });

  it('rejects a level from another programme and enforces institution scope', async () => {
    await expectCode(
      courses.create(actor, ALL, course(places.a!, 'CSC 102', { levelId: places.a!.otherLevelId })),
      'VALIDATION_FAILED',
    );
    const scopeB: TenantScope = { kind: 'institutions', institutionIds: [places.b!.institutionId] };
    await expectCode(courses.create(actor, scopeB, course(places.a!, 'CSC 103')), 'NOT_FOUND');
    const list = await courses.list(scopeB, { page: 1, pageSize: 25 });
    expect(list.items.every((c) => String(c.institutionId) === places.b!.institutionId)).toBe(true);
  });
});

describe('topics', () => {
  it('builds a two-level tree and reorders with single-key moves', async () => {
    const c = await courses.create(actor, ALL, course(places.a!, 'CSC 110'));
    const id = String(c._id);
    const t1 = await topics.create(actor, ALL, id, {
      title: 'History of Computers',
      learningObjectives: [],
    });
    const t2 = await topics.create(actor, ALL, id, {
      title: 'Computer Hardware',
      learningObjectives: [],
    });
    const t3 = await topics.create(actor, ALL, id, {
      title: 'Computer Software',
      learningObjectives: [],
    });
    const sub = await topics.create(actor, ALL, id, {
      title: 'Input devices',
      parentTopicId: String(t2._id),
      learningObjectives: [],
    });
    await expectCode(
      topics.create(actor, ALL, id, {
        title: 'Too deep',
        parentTopicId: String(sub._id),
        learningObjectives: [],
      }),
      'VALIDATION_FAILED',
    );

    // move "Computer Software" to the top (before t1)
    await topics.move(actor, ALL, String(t3._id), {
      parentTopicId: null,
      beforeId: null,
      afterId: String(t1._id),
    });
    let tree = await topics.tree(ALL, id);
    expect(tree.map((t) => t.title)).toEqual([
      'Computer Software',
      'History of Computers',
      'Computer Hardware',
    ]);
    expect(tree[2]!.subtopics.map((s) => s.title)).toEqual(['Input devices']);

    // indent "History of Computers" under "Computer Software"; a topic with children cannot be nested
    await topics.move(actor, ALL, String(t1._id), {
      parentTopicId: String(t3._id),
      beforeId: null,
      afterId: null,
    });
    await expectCode(
      topics.move(actor, ALL, String(t2._id), {
        parentTopicId: String(t3._id),
        beforeId: null,
        afterId: null,
      }),
      'VALIDATION_FAILED',
    );
    tree = await topics.tree(ALL, id);
    expect(tree.map((t) => t.title)).toEqual(['Computer Software', 'Computer Hardware']);
    expect(tree[0]!.subtopics.map((s) => s.title)).toEqual(['History of Computers']);

    // duplicate titles get unique slugs; archiving cascades
    const dup = await topics.create(actor, ALL, id, {
      title: 'Computer Hardware',
      learningObjectives: [],
    });
    expect(dup.slug).toBe('computer-hardware-2');
    await topics.archive(actor, ALL, String(t2._id));
    tree = await topics.tree(ALL, id);
    expect(tree.map((t) => t.title)).toEqual(['Computer Software', 'Computer Hardware']);
    expect(
      (await topics.tree(ALL, id, true)).find((t) => String(t.id) === String(t2._id))!.subtopics[0]!
        .archivedAt,
    ).not.toBeNull();
  });
});

describe('source documents', () => {
  it('ingests a text file into chunks with embeddings', async () => {
    const body = (
      'Operating systems manage hardware resources and provide services to programs. '.repeat(60) +
      '\n\n'
    ).repeat(2);
    const { doc } = await sources.upload(
      actor,
      ALL,
      places.a!.institutionId,
      { buffer: Buffer.from(body), originalName: 'os-notes.txt' },
      { title: 'OS lecture notes', category: 'lecture_notes', licenceType: 'institution_owned' },
    );
    expect(doc.processing.status).toBe('uploaded');
    await queue.drain();
    const [dto] = await sources.toDtos([await sources.load(ALL, String(doc._id))]);
    expect(dto!.processing).toMatchObject({ status: 'ready', embedded: true });
    expect(dto!.processing.chunkCount).toBeGreaterThan(1);
    expect(dto!.scanStatus).toBe('skipped'); // no scanner configured, and that is recorded honestly
    const withVectors = await chunkModel
      .find({ institutionId: doc.institutionId, sourceDocumentId: doc._id })
      .select('+embedding')
      .lean();
    expect(
      withVectors.every((c) => c.embedding?.length === 64 && c.embeddingModel === 'fake-hash-v1'),
    ).toBe(true);
  });

  it('rejects duplicates, unsupported and empty files', async () => {
    const meta = { title: 'Dup', category: 'reference' as const, licenceType: 'open' as const };
    const buf = Buffer.from(
      'A unique reference text about networking protocols and the OSI model.',
    );
    await sources.upload(
      actor,
      ALL,
      places.a!.institutionId,
      { buffer: buf, originalName: 'a.txt' },
      meta,
    );
    await expectCode(
      sources.upload(
        actor,
        ALL,
        places.a!.institutionId,
        { buffer: buf, originalName: 'b.txt' },
        meta,
      ),
      'CONFLICT',
    );
    await expectCode(
      sources.upload(
        actor,
        ALL,
        places.a!.institutionId,
        { buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]), originalName: 'x.pdf' },
        meta,
      ),
      'UNSUPPORTED_FILE',
    );
    await expectCode(
      sources.upload(
        actor,
        ALL,
        places.a!.institutionId,
        { buffer: Buffer.alloc(0), originalName: 'e.txt' },
        meta,
      ),
      'VALIDATION_FAILED',
    );
    // same file in another institution is fine
    await sources.upload(
      actor,
      ALL,
      places.b!.institutionId,
      { buffer: buf, originalName: 'a.txt' },
      meta,
    );
    await queue.drain();
  });

  it('only approves processed documents for generation', async () => {
    const { doc } = await sources.upload(
      actor,
      ALL,
      places.a!.institutionId,
      {
        buffer: Buffer.from('Short but valid text about databases and SQL queries.'),
        originalName: 'db.txt',
      },
      { title: 'DB', category: 'reference', licenceType: 'open' },
    );
    await expectCode(sources.setApproval(actor, ALL, String(doc._id), true), 'CONFLICT');
    await queue.drain();
    const approved = await sources.setApproval(actor, ALL, String(doc._id), true);
    expect(approved.approvedForGeneration).toBe(true);
  });
});

describe('course outlines', () => {
  it('paste → heuristic suggestion → approve → topic sync (idempotent)', async () => {
    const c = await courses.create(actor, ALL, course(places.a!, 'CSC 120'));
    const id = String(c._id);
    await topics.create(actor, ALL, id, { title: 'History of computers', learningObjectives: [] }); // pre-existing, matched case-insensitively
    await topics.create(actor, ALL, id, { title: 'Lab safety', learningObjectives: [] }); // not in outline, must be kept

    const o = await outlines.createFromPaste(actor, ALL, id, SAMPLE_OUTLINE);
    expect(['pending', 'extracting']).toContain(o.extraction.status);
    await queue.drain();
    let loaded = await outlines.load(ALL, String(o._id));
    expect(loaded.extraction).toMatchObject({ status: 'suggested', method: 'heuristic' });
    expect(loaded.extraction.detectedMetadata).toMatchObject({
      courseCode: 'CSC 101',
      creditUnits: 3,
    });
    expect(loaded.structure.map((n) => n.title)).toContain('Computer Generations');

    // syncing requires approval
    await expectCode(outlines.syncTopics(actor, ALL, String(o._id), false), 'INVALID_TRANSITION');
    await outlines.approve(actor, ALL, String(o._id));
    await expectCode(outlines.updateStructure(actor, ALL, String(o._id), []), 'VERSION_FROZEN');

    const plan = await outlines.syncTopics(actor, ALL, String(o._id), false);
    expect(plan.matched.map((m) => m.title)).toEqual(['History of Computers']);
    expect(plan.notInOutline.map((t) => t.title)).toEqual(['Lab safety']);
    expect(plan.create.filter((x) => !x.parentTitle).map((x) => x.title)).toEqual([
      'Introduction to Computer Science',
      'Computer Generations',
      'Computer Hardware',
      'Computer Software',
    ]);
    await outlines.syncTopics(actor, ALL, String(o._id), true);
    const tree = await topics.tree(ALL, id);
    expect(tree.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        'Lab safety',
        'Introduction to Computer Science',
        'Computer Software',
      ]),
    );
    expect(
      tree.find((t) => t.title === 'Introduction to Computer Science')!.subtopics,
    ).toHaveLength(2);
    const again = await outlines.syncTopics(actor, ALL, String(o._id), false);
    expect(again.create).toEqual([]);

    // a newer approved version supersedes the old one and becomes the course's active outline
    const v2 = await outlines.createManual(actor, ALL, id, [
      { key: 'a', title: 'Only topic', sourceQuote: null, confidence: null, children: [] },
    ]);
    expect(v2.version).toBe(2);
    await outlines.approve(actor, ALL, String(v2._id));
    loaded = await outlines.load(ALL, String(o._id));
    expect(loaded.status).toBe('superseded');
    expect(String((await courses.load(ALL, id)).activeOutlineId)).toBe(String(v2._id));
  });

  it('uploaded DOCX outline: ingestion then extraction, original file kept as a source', async () => {
    const c = await courses.create(actor, ALL, course(places.a!, 'CSC 130'));
    const docx = await makeDocx();
    const o = await outlines.createFromUpload(actor, ALL, String(c._id), {
      buffer: docx,
      originalName: 'outline.docx',
    });
    expect(o.sourceDocumentId).not.toBeNull();
    await queue.drain();
    const loaded = await outlines.load(ALL, String(o._id));
    expect(loaded.extraction.status).toBe('suggested');
    expect(loaded.structure.map((n) => n.title)).toEqual(['Arrays and Lists', 'Stacks and Queues']);
    expect(loaded.structure[0]!.children.map((c) => c.title)).toEqual(['Static arrays']);
    const src = await sources.load(ALL, String(o.sourceDocumentId));
    expect(src.category).toBe('course_outline');
    // the same file again for a new version re-uses the stored document
    const o2 = await outlines.createFromUpload(actor, ALL, String(c._id), {
      buffer: docx,
      originalName: 'outline.docx',
    });
    expect(String(o2.sourceDocumentId)).toBe(String(o.sourceDocumentId));
    await queue.drain();
    expect((await outlines.load(ALL, String(o2._id))).extraction.status).toBe('suggested');
  });
});
