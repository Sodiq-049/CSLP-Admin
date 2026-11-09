import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  login,
  loginWithEnrolment,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let root: Client;
let anon: Client;
let instA = '';
let instB = '';
let progA = '';

const REG = {
  email: 'new.student@test.dev',
  password: 'learner-pass-1',
  firstName: 'Ada',
  lastName: 'Obi',
  institutionSlug: 'stud-a',
};

beforeAll(async () => {
  h = await startHarness();
  await createUser(h, 'root.s@test.dev', { role: 'super_admin' });
  root = (await loginWithEnrolment(h, 'root.s@test.dev')).client;
  instA = (
    await root.post('/admin/institutions', { name: 'Stud A', shortName: 'SA', slug: 'stud-a' })
  ).body.data.id;
  instB = (
    await root.post('/admin/institutions', { name: 'Stud B', shortName: 'SB', slug: 'stud-b' })
  ).body.data.id;
  const fac = (await root.post(`/admin/institutions/${instA}/faculties`, { name: 'Tech' })).body
    .data.id;
  const dept = (
    await root.post(`/admin/institutions/${instA}/departments`, {
      facultyId: fac,
      name: 'Computing',
      code: 'CMP',
    })
  ).body.data.id;
  progA = (
    await root.post(`/admin/institutions/${instA}/programmes`, {
      departmentId: dept,
      name: 'ND Computing',
      award: 'ND',
      code: 'ND',
    })
  ).body.data.id;
  anon = new Client(h.server);
});
afterAll(async () => h.close());

describe('student registration and email verification', () => {
  it('registers with a 202 and sends a verification link; login waits for verification', async () => {
    const r = await anon.post('/auth/register', { ...REG, programmeId: progA });
    expect(r.status).toBe(202);
    expect(r.body.data.accepted).toBe(true);
    const user = await h.users.findOne({ email: REG.email }).lean();
    expect(user).toMatchObject({ accountType: 'student', emailVerifiedAt: null });
    expect(String(user!.studentProfile!.institutionId)).toBe(instA);

    const blocked = await new Client(h.server).post('/auth/login', {
      email: REG.email,
      password: REG.password,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    // Wrong password never reveals the verification state.
    const wrong = await new Client(h.server).post('/auth/login', {
      email: REG.email,
      password: 'nope-nope-1',
    });
    expect(wrong.status).toBe(401);

    const token = h.mailer.tokenFor(REG.email, /verify/i);
    expect((await anon.post('/auth/verify-email', { token })).status).toBe(200);
    expect((await anon.post('/auth/verify-email', { token })).status).toBe(404); // single use

    const c = new Client(h.server);
    const ok = await c.post('/auth/login', { email: REG.email, password: REG.password });
    expect(ok.body.data.status).toBe('authenticated');
    expect((await c.get('/student/courses')).status).toBe(200);
    expect((await c.get('/admin/dashboard/overview')).status).toBe(403);
  });

  it('answers identically for existing emails and does not create duplicates', async () => {
    h.mailer.sent.splice(0);
    const r = await anon.post('/auth/register', { ...REG, firstName: 'Someone' });
    expect(r.status).toBe(202);
    expect(await h.users.countDocuments({ email: REG.email })).toBe(1);
    expect(h.mailer.sent.length).toBeLessThanOrEqual(1);
  });

  it('validates the institution, programme and password policy', async () => {
    expect(
      (await anon.post('/auth/register', { ...REG, email: 'x1@test.dev', institutionSlug: 'nope' }))
        .body.error.code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (
        await anon.post('/auth/register', {
          ...REG,
          email: 'x2@test.dev',
          institutionSlug: 'stud-b',
          programmeId: progA,
        })
      ).status,
    ).toBe(400);
    expect(
      (await anon.post('/auth/register', { ...REG, email: 'x3@test.dev', password: 'short' }))
        .status,
    ).toBe(400);
    expect(await h.users.countDocuments({ email: /^x\d@/ })).toBe(0);
    void instB;
  });
});

describe('password reset', () => {
  it('resets via an emailed single-use link and revokes sessions', async () => {
    const session = new Client(h.server);
    await session.post('/auth/login', { email: REG.email, password: REG.password });
    expect((await session.get('/auth/me')).status).toBe(200);
    expect((await anon.post('/auth/password/forgot', { email: REG.email })).status).toBe(202);
    expect((await anon.post('/auth/password/forgot', { email: 'ghost@test.dev' })).status).toBe(
      202,
    );
    const token = h.mailer.tokenFor(REG.email, /reset/i);
    expect((await anon.post('/auth/password/reset', { token, password: 'weakpass' })).status).toBe(
      400,
    );
    expect(
      (await anon.post('/auth/password/reset', { token, password: 'brand-new-pass-2' })).status,
    ).toBe(200);
    expect(
      (await anon.post('/auth/password/reset', { token, password: 'brand-new-pass-3' })).status,
    ).toBe(404);
    expect((await session.get('/auth/me')).status).toBe(401);
    const c = new Client(h.server);
    expect(
      (await c.post('/auth/login', { email: REG.email, password: 'brand-new-pass-2' })).body.data
        .status,
    ).toBe('authenticated');
  });

  it('applies the admin password policy to admin accounts', async () => {
    await createUser(h, 'cm.reset@test.dev', { role: 'content_manager', institutionId: instA });
    await anon.post('/auth/password/forgot', { email: 'cm.reset@test.dev' });
    const token = h.mailer.tokenFor('cm.reset@test.dev', /reset/i);
    expect(
      (await anon.post('/auth/password/reset', { token, password: 'learner-pass-1' })).status,
    ).toBe(400);
  });
});

describe('admin student views', () => {
  it('lists students in scope and suspends them (revoking sessions)', async () => {
    await createUser(h, 'ia.s@test.dev', { role: 'institution_admin', institutionId: instB });
    const iaB = (await loginWithEnrolment(h, 'ia.s@test.dev')).client;
    const all = await root.get(`/admin/students?institutionId=${instA}`);
    expect(all.status).toBe(200);
    expect(all.body.data.map((s: { email: string }) => s.email)).toContain(REG.email);
    expect((await iaB.get('/admin/students')).body.data).toEqual([]);
    const id = all.body.data[0].id;
    expect((await iaB.patch(`/admin/students/${id}/status`, { status: 'suspended' })).status).toBe(
      404,
    ); // other tenant: hidden

    const s = new Client(h.server);
    await s.post('/auth/login', { email: REG.email, password: 'brand-new-pass-2' });
    expect((await s.get('/auth/me')).status).toBe(200);
    const r = await root.patch(`/admin/students/${id}/status`, {
      status: 'suspended',
      reason: 'Test',
    });
    expect(r.body.data.status).toBe('suspended');
    expect((await s.get('/auth/me')).status).toBe(401);
    await root.patch(`/admin/students/${id}/status`, { status: 'active' });
  });

  it('serves the dashboard and analytics with the right permissions', async () => {
    const d = await root.get('/admin/dashboard/overview');
    expect(d.status).toBe(200);
    expect(d.body.data.counts.registeredStudents).toBeGreaterThanOrEqual(1);
    await createUser(h, 'cm.s@test.dev', { role: 'content_manager', institutionId: instA });
    const cm = await login(h, 'cm.s@test.dev');
    expect((await cm.get('/admin/dashboard/overview')).status).toBe(200);
    expect((await cm.get('/admin/analytics/engagement')).status).toBe(403);
    expect((await cm.get('/admin/students')).status).toBe(403);
    expect(
      (await root.get(`/admin/analytics/engagement?institutionId=${instA}`)).body.data,
    ).toMatchObject({ enrolments: 0 });
  });
});
