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
