import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  API,
  Client,
  createUser,
  login,
  loginWithEnrolment,
  startHarness,
  STRONG_PASSWORD,
  totp,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h.close());

describe('platform basics', () => {
  it('health is public and enveloped, with a request id', async () => {
    const r = await request(h.server as never).get(`${API}/public/health`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ status: 'ok', checks: { mongo: 'up' } });
    expect(r.body.meta.requestId).toMatch(/^req_/);
    expect(r.headers['x-request-id']).toBe(r.body.meta.requestId);
  });

  it('honours a well-formed incoming x-request-id', async () => {
    const r = await request(h.server as never)
      .get(`${API}/public/health`)
      .set('x-request-id', 'trace-12345678');
    expect(r.body.meta.requestId).toBe('trace-12345678');
  });

  it('unknown routes and unauthenticated calls use the error envelope', async () => {
    const r1 = await request(h.server as never).get(`${API}/nope`);
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe('NOT_FOUND');
    const r2 = await request(h.server as never).get(`${API}/auth/me`);
    expect(r2.status).toBe(401);
    expect(r2.body.error).toMatchObject({ code: 'UNAUTHENTICATED', requestId: expect.any(String) });
  });
});

describe('login', () => {
  it('rejects wrong passwords with a generic message', async () => {
    await createUser(h, 'cm1@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const c = new Client(h.server);
    const r = await c.post('/auth/login', { email: 'cm1@test.dev', password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password');
    const r2 = await c.post('/auth/login', {
      email: 'nobody@test.dev',
      password: 'wrong-password',
    });
    expect(r2.body.error.message).toBe('Invalid email or password');
  });

  it('locks the account after 5 failures', async () => {
    await createUser(h, 'lock@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const c = new Client(h.server);
    for (let i = 0; i < 5; i++)
      await c.post('/auth/login', { email: 'lock@test.dev', password: 'bad' });
    const r = await c.post('/auth/login', { email: 'lock@test.dev', password: STRONG_PASSWORD });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/locked/);
  });

  it('admins with no roles cannot sign in', async () => {
    await createUser(h, 'norole@test.dev');
    const r = await new Client(h.server).post('/auth/login', {
      email: 'norole@test.dev',
      password: STRONG_PASSWORD,
    });
    expect(r.status).toBe(401);
  });

  it('validates the body', async () => {
    const r = await new Client(h.server).post('/auth/login', { email: 'not-an-email' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});

describe('MFA', () => {
  it('super admins must enrol in MFA before getting a session, then verify on later logins', async () => {
    await createUser(h, 'super@test.dev', { role: 'super_admin' });
    const { client, secret, recoveryCodes } = await loginWithEnrolment(h, 'super@test.dev');
    expect(recoveryCodes).toHaveLength(10);

    const me = await client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email: 'super@test.dev', mfaEnabled: true });
    expect(me.body.data.permissions.global).toContain('institution.create');

    // Second login: TOTP challenge (next step to avoid replay rejection of the enrolment code)
    const c2 = new Client(h.server);
    const r = await c2.post('/auth/login', { email: 'super@test.dev', password: STRONG_PASSWORD });
    expect(r.body.data.status).toBe('mfa_required');
    const bad = await c2.post('/auth/mfa/verify', {
      mfaToken: r.body.data.mfaToken,
      code: '000000',
    });
    expect(bad.status).toBe(401);
    const ok = await c2.post('/auth/mfa/verify', {
      mfaToken: r.body.data.mfaToken,
      code: totp(secret, 1),
    });
    expect(ok.status).toBe(200);
    expect((await c2.get('/auth/me')).status).toBe(200);

    // Replay of the same code is rejected
    const c3 = new Client(h.server);
    const r3 = await c3.post('/auth/login', { email: 'super@test.dev', password: STRONG_PASSWORD });
    const replay = await c3.post('/auth/mfa/verify', {
      mfaToken: r3.body.data.mfaToken,
      code: totp(secret, 1),
    });
    expect(replay.status).toBe(401);

    // Recovery codes work exactly once
    const rc = await c3.post('/auth/mfa/verify', {
      mfaToken: r3.body.data.mfaToken,
      code: recoveryCodes[0]!,
    });
    expect(rc.status).toBe(200);
    const c4 = new Client(h.server);
    const r4 = await c4.post('/auth/login', { email: 'super@test.dev', password: STRONG_PASSWORD });
    const rcAgain = await c4.post('/auth/mfa/verify', {
      mfaToken: r4.body.data.mfaToken,
      code: recoveryCodes[0]!,
    });
    expect(rcAgain.status).toBe(401);
  });

  it('an mfa token cannot be used as an access token', async () => {
    await createUser(h, 'super2@test.dev', { role: 'super_admin' });
    const r = await new Client(h.server).post('/auth/login', {
      email: 'super2@test.dev',
      password: STRONG_PASSWORD,
    });
    const me = await request(h.server as never)
      .get(`${API}/auth/me`)
      .set('authorization', `Bearer ${r.body.data.mfaToken}`);
    expect(me.status).toBe(401);
  });
});

describe('sessions', () => {
  it('requires CSRF token for cookie-authenticated mutations', async () => {
    await createUser(h, 'csrf@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const c = await login(h, 'csrf@test.dev');
    const r = await c.agent
      .post(`${API}/auth/password/change`)
      .send({ currentPassword: 'x', newPassword: 'Another-Strong-Pass1' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('Invalid CSRF token');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    await createUser(h, 'rotate@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const r = await new Client(h.server).post(
      '/auth/login',
      { email: 'rotate@test.dev', password: STRONG_PASSWORD },
      { 'x-auth-mode': 'token' },
    );
    const t1 = r.body.data.tokens;
    expect(t1.refreshToken).toBeTruthy();

    const bearer = (token: string) =>
      request(h.server as never)
        .get(`${API}/auth/me`)
        .set('authorization', `Bearer ${token}`);
    expect((await bearer(t1.accessToken)).status).toBe(200);

    const refresh = (rt: string) =>
      request(h.server as never)
        .post(`${API}/auth/refresh`)
        .set('x-auth-mode', 'token')
        .send({ refreshToken: rt });
    const r2 = await refresh(t1.refreshToken);
    expect(r2.status).toBe(200);
    const t2 = r2.body.data.tokens;
    expect(t2.refreshToken).not.toBe(t1.refreshToken);

    // Reusing the old refresh token = theft → family revoked
    expect((await refresh(t1.refreshToken)).status).toBe(401);
    expect((await refresh(t2.refreshToken)).status).toBe(401);
    expect((await bearer(t2.accessToken)).status).toBe(401);
  });

  it('logout revokes the session', async () => {
    await createUser(h, 'logout@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const c = await login(h, 'logout@test.dev');
    expect((await c.get('/auth/me')).status).toBe(200);
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('password change revokes other sessions', async () => {
    await createUser(h, 'pw@test.dev', {
      role: 'content_manager',
      institutionId: '6730a1a1a1a1a1a1a1a1a1a1',
    });
    const a = await login(h, 'pw@test.dev');
    const b = await login(h, 'pw@test.dev');
    const r = await a.post('/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'Brand-New-Pass-42',
    });
    expect(r.status).toBe(200);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
  });

  it('students cannot reach admin routes', async () => {
    await createUser(h, 'student@test.dev', { accountType: 'student' });
    const c = await login(h, 'student@test.dev');
    const r = await c.get('/admin/institutions');
    expect(r.status).toBe(403);
  });
});
