import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  createUser,
  STRONG_PASSWORD,
  startHarness,
  totp,
  type Harness,
} from './harness.js';

/** Default configuration (MFA_REQUIRED off): plain email + password sign-in for every role. */
let h: Harness;
beforeAll(async () => {
  h = await startHarness({ MFA_REQUIRED: 'false' });
});
afterAll(async () => h.close());

describe('optional two-step verification', () => {
  it('a super admin signs in with email and password only and can use the portal', async () => {
    await createUser(h, 'plain.root@test.dev', { role: 'super_admin' });
    const c = new Client(h.server);
    const r = await c.post('/auth/login', {
      email: 'plain.root@test.dev',
      password: STRONG_PASSWORD,
    });
    expect(r.body.data.status).toBe('authenticated');
    expect((await c.get('/admin/institutions')).status).toBe(200);
  });

  it('users who turn MFA on themselves are still asked for their code', async () => {
    const c = new Client(h.server);
    await c.post('/auth/login', { email: 'plain.root@test.dev', password: STRONG_PASSWORD });
    const { secret } = (await c.post('/auth/mfa/enrol')).body.data;
    expect((await c.post('/auth/mfa/confirm', { code: totp(secret) })).status).toBe(200);
    const again = await new Client(h.server).post('/auth/login', {
      email: 'plain.root@test.dev',
      password: STRONG_PASSWORD,
    });
    expect(again.body.data.status).toBe('mfa_required');
  });
});

describe('visitor IP relayed by the admin portal', () => {
  let p: Harness;
  const SECRET = 'proxy-secret-'.padEnd(40, 'z');
  beforeAll(async () => {
    p = await startHarness({ MFA_REQUIRED: 'false', PROXY_SHARED_SECRET: SECRET });
    await createUser(p, 'ip.user@test.dev', { role: 'super_admin' });
  });
  afterAll(async () => p.close());
  const lastIp = async () =>
    (await p.users.findOne({ email: 'ip.user@test.dev' }).lean())!.security.lastLoginIp;
  const login = (headers: Record<string, string>) =>
    new Client(p.server).post(
      '/auth/login',
      { email: 'ip.user@test.dev', password: STRONG_PASSWORD },
      headers,
    );

  it('uses the reported IP only when the shared secret matches', async () => {
    await login({ 'x-cslp-proxy-secret': SECRET, 'x-cslp-client-ip': '203.0.113.7' });
    expect(await lastIp()).toBe('203.0.113.7');
    await login({
      'x-cslp-proxy-secret': 'wrong'.padEnd(40, 'x'),
      'x-cslp-client-ip': '198.51.100.9',
    });
    expect(await lastIp()).not.toBe('198.51.100.9');
    await login({ 'x-cslp-client-ip': '198.51.100.9' });
    expect(await lastIp()).not.toBe('198.51.100.9');
  });
});
