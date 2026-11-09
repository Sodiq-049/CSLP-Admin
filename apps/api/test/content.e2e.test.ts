import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobQueue } from '@cslp/server-core';
import {
  Client,
  createUser,
  login,
  loginWithEnrolment,
  startHarness,
  type Harness,
} from './harness.js';

/** Fictional outline used only in tests (not an official course record). */
const OUTLINE = `Course Content
Week 1: Introduction to Computer Science
1.1 Definition of computer science
Week 2: History of Computers
Week 3: Computer Generations
REFERENCES
- Some book (2020)`;

let h: Harness;
let root: Client;
let cmA: Client;
let reviewerA: Client;
let cmB: Client;
let instA: string;
let instB: string;
let progA: string;
let levelA: string;
let semA: string;
const drain = () => h.app.get(JobQueue).drain();

async function structure(c: Client, inst: string) {
  const fac = (await c.post(`/admin/institutions/${inst}/faculties`, { name: 'Technology' })).body
    .data.id;
  const dept = (
    await c.post(`/admin/institutions/${inst}/departments`, {
      facultyId: fac,
      name: 'Computing',
      code: 'CMP',
    })
  ).body.data.id;
  const prog = (
    await c.post(`/admin/institutions/${inst}/programmes`, {
      departmentId: dept,
      name: 'ND Computing',
      award: 'ND',
      code: 'ND',
    })
  ).body.data.id;
  const level = (
    await c.post(`/admin/programmes/${prog}/levels`, { name: 'ND 1', code: 'ND1', rank: 1 })
  ).body.data.id;
  const sem = (
    await c.post(`/admin/institutions/${inst}/semesters`, { name: 'First', code: 'S1', rank: 1 })
  ).body.data.id;
  return { prog, level, sem };
}

beforeAll(async () => {
  h = await startHarness();
  await createUser(h, 'root2@test.dev', { role: 'super_admin' });
  root = (await loginWithEnrolment(h, 'root2@test.dev')).client;
  instA = (
    await root.post('/admin/institutions', {
      name: 'Content A',
      shortName: 'CA',
      slug: 'content-a',
    })
  ).body.data.id;
  instB = (
    await root.post('/admin/institutions', {
      name: 'Content B',
      shortName: 'CB',
      slug: 'content-b',
    })
  ).body.data.id;
  ({ prog: progA, level: levelA, sem: semA } = await structure(root, instA));
  await structure(root, instB);
  await createUser(h, 'cm.a@test.dev', { role: 'content_manager', institutionId: instA });
  await createUser(h, 'rev.a@test.dev', { role: 'academic_reviewer', institutionId: instA });
  await createUser(h, 'cm.b@test.dev', { role: 'content_manager', institutionId: instB });
  cmA = await login(h, 'cm.a@test.dev');
  reviewerA = await login(h, 'rev.a@test.dev');
  cmB = await login(h, 'cm.b@test.dev');
});
afterAll(async () => {
  await drain();
  await h.close();
});

describe('courses & topics over HTTP', () => {
  let courseId: string;

  it('content manager creates a draft course; duplicates are rejected with a stable code', async () => {
    const body = {
      programmeId: progA,
      levelId: levelA,
      semesterId: semA,
      code: 'COM 001',
      title: 'Introduction to Computer Science',
      creditUnits: 3,
      isDemoData: true,
    };
    const r = await cmA.post('/admin/courses', body);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      code: 'COM 001',
      isDemoData: true,
      publication: { state: 'unpublished' },
      labels: { programme: 'ND Computing', level: 'ND 1' },
    });
    courseId = r.body.data.id;
    const dup = await cmA.post('/admin/courses', { ...body, code: 'com001' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_COURSE_CODE');
  });

  it('other institutions cannot see or create courses there', async () => {
    expect((await cmB.get(`/admin/courses/${courseId}`)).status).toBe(404);
    expect(
      (
        await cmB.post('/admin/courses', {
          programmeId: progA,
          levelId: levelA,
          semesterId: semA,
          code: 'COM 002',
          title: 'Sneaky',
          creditUnits: 1,
        })
      ).status,
    ).toBe(404);
    const list = await cmB.get('/admin/courses');
    expect(list.body.data).toEqual([]);
  });

  it('reviewers can view but not edit courses or topics', async () => {
    expect((await reviewerA.get(`/admin/courses/${courseId}`)).status).toBe(200);
    expect((await reviewerA.patch(`/admin/courses/${courseId}`, { title: 'Nope' })).status).toBe(
      403,
    );
    expect(
      (await reviewerA.post(`/admin/courses/${courseId}/topics`, { title: 'Nope' })).status,
    ).toBe(403);
  });

  it('creates, nests and reorders topics', async () => {
    const a = (await cmA.post(`/admin/courses/${courseId}/topics`, { title: 'Computer Hardware' }))
      .body.data.id;
    const b = (await cmA.post(`/admin/courses/${courseId}/topics`, { title: 'Computer Software' }))
      .body.data.id;
    await cmA.post(`/admin/courses/${courseId}/topics`, {
      title: 'Input devices',
      parentTopicId: a,
    });
    const mv = await cmA.post(`/admin/topics/${b}/move`, { parentTopicId: null, afterId: a });
    expect(mv.status).toBe(200);
    const tree = await cmA.get(`/admin/courses/${courseId}/topics`);
    expect(tree.body.data.map((t: { title: string }) => t.title)).toEqual([
      'Computer Software',
      'Computer Hardware',
    ]);
    expect(tree.body.data[1].subtopics[0].title).toBe('Input devices');
    expect((await cmB.post(`/admin/topics/${b}/move`, { parentTopicId: null })).status).toBe(404);
  });
});

describe('course outlines over HTTP', () => {
  let courseId: string;
  let outlineId: string;

  beforeAll(async () => {
    courseId = (
      await cmA.post('/admin/courses', {
        programmeId: progA,
        levelId: levelA,
        semesterId: semA,
        code: 'COM 010',
        title: 'Outline course',
        creditUnits: 2,
      })
    ).body.data.id;
  });

  it('paste → suggested structure', async () => {
    const r = await cmA.post(`/admin/courses/${courseId}/outlines`, {
      origin: 'paste',
      text: OUTLINE,
    });
    expect(r.status).toBe(201);
    outlineId = r.body.data.id;
    await drain();
    const o = await cmA.get(`/admin/outlines/${outlineId}`);
    expect(o.body.data.extraction.status).toBe('suggested');
    expect(o.body.data.structure.map((n: { title: string }) => n.title)).toEqual([
      'Introduction to Computer Science',
      'History of Computers',
      'Computer Generations',
    ]);
    const drafts = await cmA.get('/admin/outlines');
    expect(
      drafts.body.data.some((d: { outline: { id: string } }) => d.outline.id === outlineId),
    ).toBe(true);
  });

  it('content managers cannot approve; reviewers can; then topics sync from the approved outline', async () => {
    expect((await cmA.post(`/admin/outlines/${outlineId}/approve`)).status).toBe(403);
    expect((await reviewerA.post(`/admin/outlines/${outlineId}/approve`)).status).toBe(200);
    const plan = await cmA.post(`/admin/outlines/${outlineId}/sync-topics`);
    expect(plan.body.data).toMatchObject({ applied: false });
    expect(plan.body.data.create).toHaveLength(4);
    const applied = await cmA.post(`/admin/outlines/${outlineId}/sync-topics?apply=true`);
    expect(applied.body.data.applied).toBe(true);
    const tree = await cmA.get(`/admin/courses/${courseId}/topics`);
    expect(tree.body.data).toHaveLength(3);
    expect((await cmA.get(`/admin/courses/${courseId}`)).body.data.activeOutlineId).toBe(outlineId);
  });

  it('uploads an outline file (licence confirmation required)', async () => {
    const noLicence = await cmA.agent
      .post(`/api/v1/admin/courses/${courseId}/outlines/upload`)
      .set('x-csrf-token', cmA.csrf)
      .attach('file', Buffer.from(OUTLINE), 'outline.txt');
    expect(noLicence.status).toBe(400);
    const r = await cmA.agent
      .post(`/api/v1/admin/courses/${courseId}/outlines/upload`)
      .set('x-csrf-token', cmA.csrf)
      .field('licenceConfirmed', 'true')
      .attach('file', Buffer.from(OUTLINE + '\nWeek 4: Computer Hardware'), 'outline.txt');
    expect(r.status).toBe(201);
    expect(r.body.data.origin).toBe('upload');
    await drain();
    const o = await cmA.get(`/admin/outlines/${r.body.data.id}`);
    expect(o.body.data.structure.map((n: { title: string }) => n.title)).toContain(
      'Computer Hardware',
    );
    expect((await cmA.get(`/admin/outlines/${r.body.data.id}/document`)).body.data.url).toMatch(
      /^memory:\/\//,
    );
  });
});

describe('source documents over HTTP', () => {
  it('uploads, processes, inspects chunks and approves', async () => {
    const text = 'Computer networks connect devices so they can share data. '.repeat(80);
    const r = await cmA.agent
      .post(`/api/v1/admin/institutions/${instA}/source-documents`)
      .set('x-csrf-token', cmA.csrf)
      .field('title', 'Networking notes')
      .field('category', 'lecture_notes')
      .field('licenceType', 'institution_owned')
      .field('licenceConfirmed', 'true')
      .attach('file', Buffer.from(text), 'networks.txt');
    expect(r.status).toBe(201);
    const id = r.body.data.id;
    await drain();
    const doc = await cmA.get(`/admin/source-documents/${id}`);
    expect(doc.body.data.processing).toMatchObject({ status: 'ready', embedded: false });
    expect(doc.body.data.processing.warnings.join(' ')).toMatch(/Embeddings were skipped/);
    const chunks = await cmA.get(`/admin/source-documents/${id}/chunks`);
    expect(chunks.body.meta.total).toBeGreaterThan(0);
    const jobs = await cmA.get(`/admin/source-documents/${id}/jobs`);
    expect(jobs.body.data[0]).toMatchObject({ type: 'document_ingest', status: 'completed' });
    expect((await cmA.get(`/admin/ai-jobs/${jobs.body.data[0].id}`)).status).toBe(200);
    expect((await cmB.get(`/admin/ai-jobs/${jobs.body.data[0].id}`)).status).toBe(404);

    expect((await cmA.post(`/admin/source-documents/${id}/approve-for-generation`)).status).toBe(
      403,
    );
    const ok = await reviewerA.post(`/admin/source-documents/${id}/approve-for-generation`);
    expect(ok.body.data.approvedForGeneration).toBe(true);
    expect((await cmB.get(`/admin/source-documents/${id}`)).status).toBe(404);
  });

  it('rejects unsupported files and other institutions', async () => {
    const bad = await cmA.agent
      .post(`/api/v1/admin/institutions/${instA}/source-documents`)
      .set('x-csrf-token', cmA.csrf)
      .field('title', 'Binary')
      .field('category', 'other')
      .field('licenceType', 'open')
      .field('licenceConfirmed', 'true')
      .attach('file', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3]), 'tool.pdf');
    expect(bad.status).toBe(415);
    expect(bad.body.error.code).toBe('UNSUPPORTED_FILE');
    const other = await cmB.agent
      .post(`/api/v1/admin/institutions/${instA}/source-documents`)
      .set('x-csrf-token', cmB.csrf)
      .field('title', 'x')
      .field('category', 'other')
      .field('licenceType', 'open')
      .field('licenceConfirmed', 'true')
      .attach('file', Buffer.from('hello world text'), 'a.txt');
    expect(other.status).toBe(404);
  });
});

describe('AI content over HTTP', () => {
  let courseId: string;
  let topicId: string;

  beforeAll(async () => {
    courseId = (
      await cmA.post('/admin/courses', {
        programmeId: progA,
        levelId: levelA,
        semesterId: semA,
        code: 'COM 050',
        title: 'Generation course',
        creditUnits: 2,
      })
    ).body.data.id;
    topicId = (await cmA.post(`/admin/courses/${courseId}/topics`, { title: 'Operating Systems' }))
      .body.data.id;
  });

  it('generates a draft, edits it, submits it; author cannot review; reviewer approves', async () => {
    expect(
      (
        await reviewerA.post(`/admin/courses/${courseId}/generate-content`, {
          topicIds: [topicId],
          kinds: ['notes_simplified'],
        })
      ).status,
    ).toBe(403);
    const gen = await cmA.post(`/admin/courses/${courseId}/generate-content`, {
      topicIds: [topicId],
      kinds: ['notes_simplified'],
    });
    expect(gen.status).toBe(202);
    const { versionId } = gen.body.data.jobs[0];
    await drain();
    let v = (await cmA.get(`/admin/versions/${versionId}`)).body.data;
    // No approved sources for this topic in this test: generation still produces a draft, flagged as insufficient.
    expect(v).toMatchObject({
      generationStatus: 'generated',
      reviewStatus: 'draft',
      provenance: { insufficientSources: true },
    });

    const saved = await cmA.patch(`/admin/versions/${versionId}`, {
      autosaveRev: v.autosaveRev,
      body: {
        kind: 'notes',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewed wording.' }] }],
        },
        wordCount: 0,
        readingMinutes: 0,
      },
    });
    expect(saved.status).toBe(200);
    const stale = await cmA.patch(`/admin/versions/${versionId}`, {
      autosaveRev: v.autosaveRev,
      body: { kind: 'notes', doc: { type: 'doc', content: [] }, wordCount: 0, readingMinutes: 0 },
    });
    expect(stale.status).toBe(412);

    expect((await cmA.post(`/admin/versions/${versionId}/submit-review`)).body.data.frozen).toBe(
      true,
    );
    expect(
      (
        await cmA.post(`/admin/versions/${versionId}/reviews`, {
          decision: 'approved',
          checklist: {
            accuracy: true,
            objectivesCovered: true,
            citationsChecked: true,
            appropriateLevel: true,
          },
        })
      ).status,
    ).toBe(403); // CMs lack content.review
    const incomplete = await reviewerA.post(`/admin/versions/${versionId}/reviews`, {
      decision: 'approved',
      checklist: {
        accuracy: true,
        objectivesCovered: false,
        citationsChecked: true,
        appropriateLevel: true,
      },
    });
    expect(incomplete.status).toBe(400);
    const q = await reviewerA.get('/admin/reviews/queue');
    expect(q.body.data.map((i: { versionId: string }) => i.versionId)).toContain(versionId);
    const ok = await reviewerA.post(`/admin/versions/${versionId}/reviews`, {
      decision: 'approved',
      comment: 'Fine for students',
      checklist: {
        accuracy: true,
        objectivesCovered: true,
        citationsChecked: true,
        appropriateLevel: true,
      },
    });
    expect(ok.body.data.reviewStatus).toBe('approved');
    const mats = await cmA.get(`/admin/topics/${topicId}/materials`);
    expect(mats.body.data[0]).toMatchObject({
      kind: 'notes_simplified',
      displayStatus: 'approved',
      latestApprovedVersionId: versionId,
    });
    v = await cmB.get(`/admin/versions/${versionId}`);
    expect(v.status).toBe(404);
  });
});

describe('quizzes, editor actions and usage over HTTP', () => {
  it('enforces permissions on the new endpoints', async () => {
    expect((await reviewerA.get('/admin/ai-usage/summary')).status).toBe(403); // reviewers lack ai_usage.view
    expect((await cmA.get('/admin/ai-usage/summary')).status).toBe(403);
    const usage = await root.get(`/admin/ai-usage/summary?institutionId=${instA}`);
    expect(usage.status).toBe(200);
    expect(usage.body.data).toMatchObject({ institutionId: instA, pricesConfigured: false });
    expect((await cmB.get(`/admin/ai-usage/summary?institutionId=${instA}`)).status).toBe(403);
    const qs = await cmA.get('/admin/questions');
    expect(qs.status).toBe(200);
    expect(
      (await reviewerA.post('/admin/versions/6730aaaaaaaaaaaaaaaaaaaa/generate-questions', {}))
        .status,
    ).toBe(403); // no quiz.manage anywhere
    expect(
      (await cmA.post('/admin/versions/6730aaaaaaaaaaaaaaaaaaaa/generate-questions', {})).status,
    ).toBe(404); // allowed role, unknown version
  });
});

describe('publishing and the student API over HTTP', () => {
  let student: Client;
  let studentB: Client;
  let courseId: string;
  let topicId: string;
  let materialId: string;
  let versionId: string;

  beforeAll(async () => {
    const sid = await createUser(h, 'student.a@test.dev', { accountType: 'student' });
    await h.users.updateOne(
      { _id: sid },
      { $set: { studentProfile: { institutionId: instA } } },
      { strict: false },
    );
    student = await login(h, 'student.a@test.dev');
    const sidB = await createUser(h, 'student.b@test.dev', { accountType: 'student' });
    await h.users.updateOne(
      { _id: sidB },
      { $set: { studentProfile: { institutionId: instB } } },
      { strict: false },
    );
    studentB = await login(h, 'student.b@test.dev');

    courseId = (
      await cmA.post('/admin/courses', {
        programmeId: progA,
        levelId: levelA,
        semesterId: semA,
        code: 'COM 090',
        title: 'Published course',
        creditUnits: 2,
      })
    ).body.data.id;
    topicId = (await cmA.post(`/admin/courses/${courseId}/topics`, { title: 'Networks' })).body.data
      .id;
    const gen = await cmA.post(`/admin/courses/${courseId}/generate-content`, {
      topicIds: [topicId],
      kinds: ['revision_pack'],
    });
    ({ versionId, materialId } = gen.body.data.jobs[0]);
    await drain();
    await cmA.post(`/admin/versions/${versionId}/submit-review`);
    await reviewerA.post(`/admin/versions/${versionId}/reviews`, {
      decision: 'approved',
      comment: '',
      checklist: {
        accuracy: true,
        objectivesCovered: true,
        citationsChecked: true,
        appropriateLevel: true,
      },
    });
  });

  it('only publishers may publish; students cannot use admin routes', async () => {
    expect((await cmA.post(`/admin/materials/${materialId}/publish`, { versionId })).status).toBe(
      403,
    );
    expect(
      (await reviewerA.post(`/admin/materials/${materialId}/publish`, { versionId })).status,
    ).toBe(403);
    expect((await student.get('/admin/publishing/overview')).status).toBe(403);
    expect((await cmA.get('/student/courses')).status).toBe(403); // admins are not students
  });

  it('students see a material only after course, topic and material are published', async () => {
    expect((await student.get(`/student/materials/${materialId}`)).status).toBe(404);
    expect(
      (await root.post(`/admin/materials/${materialId}/publish`, { versionId })).body.data.state,
    ).toBe('published');
    expect((await student.get(`/student/materials/${materialId}`)).status).toBe(404);
    expect((await root.post(`/admin/courses/${courseId}/publish`)).status).toBe(200);
    expect((await root.post(`/admin/topics/${topicId}/publish`)).status).toBe(200);
    const m = await student.get(`/student/materials/${materialId}`);
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({
      kind: 'revision_pack',
      course: { code: 'COM 090' },
      content: { kind: 'revision_pack' },
    });
    const list = await student.get('/student/courses');
    expect(list.body.data.map((c: { code: string }) => c.code)).toContain('COM 090');
    const detail = await student.get(`/student/courses/${courseId}`);
    expect(detail.body.data.topics[0].materials[0].id).toBe(materialId);
    expect((await studentB.get(`/student/materials/${materialId}`)).status).toBe(404);
    expect((await studentB.get('/student/courses')).body.data).toEqual([]);
    const overview = await root.get(`/admin/publishing/overview?institutionId=${instA}`);
    expect(overview.body.data.published.map((i: { materialId: string }) => i.materialId)).toContain(
      materialId,
    );
    const events = await root.get(`/admin/publication-events?institutionId=${instA}`);
    expect(events.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['publish', 'publish_course', 'publish_topic']),
    );
  });

  it('preview-as-student uses the student serializer', async () => {
    const p = await cmA.get(`/admin/versions/${versionId}/preview-as-student`);
    expect(p.status).toBe(200);
    expect(JSON.stringify(p.body.data)).not.toMatch(/reviewStatus|autosaveRev|generation/);
    expect((await cmB.get(`/admin/versions/${versionId}/preview-as-student`)).status).toBe(404);
  });

  it('unpublishing hides it again', async () => {
    expect(
      (await root.post(`/admin/materials/${materialId}/unpublish`, { reason: 'Checking' })).status,
    ).toBe(200);
    expect((await student.get(`/student/materials/${materialId}`)).status).toBe(404);
  });
});
