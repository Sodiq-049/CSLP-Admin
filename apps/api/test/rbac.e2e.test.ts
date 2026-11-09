import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MODELS, type AuthSessionDoc } from '@cslp/server-core';
import { buildOpenApiDocument } from '../src/openapi/document.js';
import {
  API,
  Client,
  createUser,
  login,
  loginWithEnrolment,
  startHarness,
  STRONG_PASSWORD,
  type Harness,
} from './harness.js';

let h: Harness;
let superAdmin: Client;
let instA: string;
let instB: string;
let adminA: Client; // institution admin of A (onboarded via real invitation flow)
let cmA: Client; // content manager of A
let reviewerA: Client;
let cmAUserId: string;
let facultyB: string;

beforeAll(async () => {
  h = await startHarness();
  await createUser(h, 'root@test.dev', { role: 'super_admin' });
  superAdmin = (await loginWithEnrolment(h, 'root@test.dev')).client;

  const a = await superAdmin.post('/admin/institutions', {
    name: 'Demo Polytechnic A',
    shortName: 'DPA',
    slug: 'demo-a',
  });
  expect(a.status).toBe(201);
  instA = a.body.data.id;
  const b = await superAdmin.post('/admin/institutions', {
    name: 'Demo Polytechnic B',
    shortName: 'DPB',
    slug: 'demo-b',
  });
  instB = b.body.data.id;
  facultyB = (
    await superAdmin.post(`/admin/institutions/${instB}/faculties`, { name: 'Engineering' })
  ).body.data.id;

  // Institution admin for A via the real invitation flow
  const inv = await superAdmin.post('/admin/admin-users', {
    email: 'ia@test.dev',
    role: 'institution_admin',
    institutionId: instA,
  });
  expect(inv.status).toBe(201);
  expect(inv.body.data.status).toBe('invited');
  const token = h.mailer.inviteTokenFor('ia@test.dev');
  const acc = await new Client(h.server).post(`/auth/invitations/${token}/accept`, {
    password: STRONG_PASSWORD,
    firstName: 'Ada',
    lastName: 'Admin',
  });
  expect(acc.status).toBe(200);
  // tokens are single-use
  expect(
    (
      await new Client(h.server).post(`/auth/invitations/${token}/accept`, {
        password: STRONG_PASSWORD,
        firstName: 'x',
        lastName: 'y',
      })
    ).status,
  ).toBe(404);
  adminA = (await loginWithEnrolment(h, 'ia@test.dev')).client;

  cmAUserId = await createUser(h, 'cm-a@test.dev', {
    role: 'content_manager',
    institutionId: instA,
  });
  cmA = await login(h, 'cm-a@test.dev');
  await createUser(h, 'rev-a@test.dev', { role: 'academic_reviewer', institutionId: instA });
  reviewerA = await login(h, 'rev-a@test.dev');
});
afterAll(async () => h.close());

describe('every admin route requires authentication (generated from OpenAPI)', () => {
  it('returns 401 without credentials', async () => {
    const doc = buildOpenApiDocument(h.app);
    const fake = '6730aaaaaaaaaaaaaaaaaaaa';
    let checked = 0;
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (!path.startsWith('/api/v1/admin')) continue;
      for (const method of Object.keys(ops).filter((m) =>
        ['get', 'post', 'patch', 'put', 'delete'].includes(m),
      )) {
        const url = path.replace(/\{[^}]+\}/g, fake);
        const r = await (
          request(h.server as never) as unknown as Record<string, (u: string) => request.Test>
        )[method]!(url);
        expect(r.status, `${method.toUpperCase()} ${path}`).toBe(401);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('institution administration', () => {
  it('institution admin sees only their institution', async () => {
    const r = await adminA.get('/admin/institutions');
    expect(r.body.data.map((i: { id: string }) => i.id)).toEqual([instA]);
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect((await adminA.get(`/admin/institutions/${instB}`)).status).toBe(404);
  });

  it('only super admins create institutions', async () => {
    const r = await adminA.post('/admin/institutions', {
      name: 'Rogue',
      shortName: 'RG',
      slug: 'rogue',
    });
    expect(r.status).toBe(403);
  });

  it('rejects duplicate slugs', async () => {
    const r = await superAdmin.post('/admin/institutions', {
      name: 'Dup',
      shortName: 'DU',
      slug: 'demo-a',
    });
    expect(r.status).toBe(409);
  });
});

describe('academic structure permissions and isolation', () => {
  let facultyA: string;

  it('institution admin manages structure in their institution', async () => {
    const f = await adminA.post(`/admin/institutions/${instA}/faculties`, {
      name: 'School of Technology',
    });
    expect(f.status).toBe(201);
    facultyA = f.body.data.id;
    const d = await adminA.post(`/admin/institutions/${instA}/departments`, {
      facultyId: facultyA,
      name: 'Computer Science',
      code: 'CSC',
    });
    expect(d.status).toBe(201);
    const p = await adminA.post(`/admin/institutions/${instA}/programmes`, {
      departmentId: d.body.data.id,
      name: 'National Diploma in Computer Science',
      award: 'ND',
      code: 'ND-CS',
    });
    expect(p.status).toBe(201);
    const l = await adminA.post(`/admin/programmes/${p.body.data.id}/levels`, {
      name: 'ND 1',
      code: 'ND1',
      rank: 1,
    });
    expect(l.status).toBe(201);
    const s = await adminA.post(`/admin/institutions/${instA}/semesters`, {
      name: 'First Semester',
      code: 'S1',
      rank: 1,
    });
    expect(s.status).toBe(201);

    const tree = await cmA.get(`/admin/institutions/${instA}/academic-tree`);
    expect(tree.status).toBe(200);
    expect(tree.body.data.faculties[0].departments[0].programmes[0].levels[0].code).toBe('ND1');
  });

  it('cannot touch another institution — 404, not 403', async () => {
    expect((await adminA.get(`/admin/institutions/${instB}/faculties`)).status).toBe(404);
    expect(
      (await adminA.post(`/admin/institutions/${instB}/faculties`, { name: 'X' })).status,
    ).toBe(404);
    expect((await adminA.patch(`/admin/faculties/${facultyB}`, { name: 'Hacked' })).status).toBe(
      404,
    );
    expect((await adminA.post(`/admin/faculties/${facultyB}/archive`)).status).toBe(404);
  });

  it('cannot attach a parent from another institution', async () => {
    const r = await adminA.post(`/admin/institutions/${instA}/departments`, {
      facultyId: facultyB,
      name: 'Sneaky',
      code: 'SNK',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe('facultyId');
  });

  it('content managers and reviewers can view but not manage structure — 403 in own institution', async () => {
    expect((await cmA.get(`/admin/institutions/${instA}/faculties`)).status).toBe(200);
    expect((await reviewerA.get(`/admin/institutions/${instA}/faculties`)).status).toBe(200);
    expect(
      (await cmA.post(`/admin/institutions/${instA}/faculties`, { name: 'Nope' })).status,
    ).toBe(403);
    expect((await reviewerA.patch(`/admin/faculties/${facultyA}`, { name: 'Nope' })).status).toBe(
      403,
    );
  });

  it('malformed ids are 404', async () => {
    expect((await adminA.patch('/admin/faculties/not-an-id', { name: 'x' })).status).toBe(404);
  });

  it('validation errors carry field paths', async () => {
    const r = await adminA.post(`/admin/institutions/${instA}/programmes`, {
      name: 'X',
      award: 'PhD',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['departmentId', 'award', 'code']),
    );
  });
});

describe('administrator management', () => {
  it('institution admin can invite staff for their institution only', async () => {
    const ok = await adminA.post('/admin/admin-users', {
      email: 'new-cm@test.dev',
      role: 'content_manager',
      institutionId: instA,
    });
    expect(ok.status).toBe(201);
    expect(
      (
        await adminA.post('/admin/admin-users', {
          email: 'x1@test.dev',
          role: 'content_manager',
          institutionId: instB,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await adminA.post('/admin/admin-users', {
          email: 'x2@test.dev',
          role: 'institution_admin',
          institutionId: instA,
        })
      ).status,
    ).toBe(403);
    expect(
      (await adminA.post('/admin/admin-users', { email: 'x3@test.dev', role: 'super_admin' }))
        .status,
    ).toBe(403);
  });

  it('content managers cannot invite', async () => {
    const r = await cmA.post('/admin/admin-users', {
      email: 'x4@test.dev',
      role: 'content_manager',
      institutionId: instA,
    });
    expect(r.status).toBe(403);
  });

  it('lists only users of the caller’s institutions', async () => {
    await createUser(h, 'cm-b@test.dev', { role: 'content_manager', institutionId: instB });
    const r = await adminA.get('/admin/admin-users');
    const emails = r.body.data.map((u: { email: string }) => u.email);
    expect(emails).toContain('cm-a@test.dev');
    expect(emails).not.toContain('cm-b@test.dev');
    expect(emails).not.toContain('root@test.dev');
  });

  it('role changes require recent authentication', async () => {
    const sessions = h.app.get<Model<AuthSessionDoc>>(getModelToken(MODELS.AuthSession));
    const ia = await h.users.findOne({ email: 'ia@test.dev' });
    await sessions.updateMany(
      { userId: ia!._id },
      { $set: { authTime: new Date(Date.now() - 60 * 60 * 1000) } },
    );
    const r = await adminA.post(`/admin/admin-users/${cmAUserId}/roles`, {
      role: 'academic_reviewer',
      institutionId: instA,
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('RECENT_AUTH_REQUIRED');
  });

  it('suspending a user revokes their sessions immediately', async () => {
    const sessions = h.app.get<Model<AuthSessionDoc>>(getModelToken(MODELS.AuthSession));
    const ia = await h.users.findOne({ email: 'ia@test.dev' });
    await sessions.updateMany({ userId: ia!._id }, { $set: { authTime: new Date() } }); // as if just re-authenticated

    expect((await cmA.get('/auth/me')).status).toBe(200);
    const r = await adminA.post(`/admin/admin-users/${cmAUserId}/suspend`);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('suspended');
    expect((await cmA.get('/auth/me')).status).toBe(401);
  });

  it('institution admins cannot suspend their superiors; the last super admin is protected', async () => {
    const root = await h.users.findOne({ email: 'root@test.dev' });
    expect((await adminA.post(`/admin/admin-users/${root!._id}/suspend`)).status).toBe(404);
    const me = await superAdmin.get('/auth/me');
    const superAssignment = me.body.data.assignments.find(
      (a: { role: string }) => a.role === 'super_admin',
    );
    const r = await superAdmin.delete(
      `/admin/admin-users/${root!._id}/roles/${superAssignment.id}`,
    );
    expect(r.status).toBe(409);
  });
});
