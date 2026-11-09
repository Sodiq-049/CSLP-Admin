import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Model } from 'mongoose';
import * as OTPAuth from 'otpauth';
import request, { type Response } from 'supertest';
import { hashPassword, MODELS, type RoleAssignmentDoc, type UserDoc } from '@cslp/server-core';
import type { Role } from '@cslp/shared-types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/env.js';
import { MAILER, type MailMessage, type Mailer } from '../src/mail/mail.module.js';

export const API = '/api/v1';
export const STRONG_PASSWORD = 'Correct-Horse-9-Battery';

export class CapturingMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
  }
  inviteTokenFor(email: string): string {
    const m = [...this.sent].reverse().find((x) => x.to === email);
    const token = m?.text.match(/token=([^\s]+)/)?.[1];
    if (!token) throw new Error(`No invitation sent to ${email}`);
    return decodeURIComponent(token);
  }
  /** Token from the latest email to `email` whose subject matches. */
  tokenFor(email: string, subject: RegExp): string {
    const m = [...this.sent].reverse().find((x) => x.to === email && subject.test(x.subject));
    const token = m?.text.match(/token=([^\s]+)/)?.[1];
    if (!token) throw new Error(`No "${subject}" email sent to ${email}`);
    return decodeURIComponent(token);
  }
}

/** Cookie-carrying client that echoes the CSRF cookie, like the admin app will. */
export class Client {
  csrf = '';
  readonly agent: ReturnType<typeof request.agent>;
  constructor(server: unknown) {
    this.agent = request.agent(server as never);
  }
  private capture = (res: Response) => {
    const cookies = ([] as string[]).concat(
      (res.headers['set-cookie'] as unknown as string[]) ?? [],
    );
    for (const c of cookies) {
      const m = /^cslp_csrf=([^;]*)/.exec(c);
      if (m) this.csrf = m[1]!;
    }
    return res;
  };
  get(url: string): Promise<Response> {
    return this.agent.get(API + url).then(this.capture);
  }
  post(url: string, body: object = {}, headers: Record<string, string> = {}): Promise<Response> {
    return this.agent
      .post(API + url)
      .set('x-csrf-token', this.csrf)
      .set(headers)
      .send(body)
      .then(this.capture);
  }
  put(url: string, body: object = {}): Promise<Response> {
    return this.agent
      .put(API + url)
      .set('x-csrf-token', this.csrf)
      .send(body)
      .then(this.capture);
  }
  patch(url: string, body: object = {}): Promise<Response> {
    return this.agent
      .patch(API + url)
      .set('x-csrf-token', this.csrf)
      .send(body)
      .then(this.capture);
  }
  delete(url: string): Promise<Response> {
    return this.agent
      .delete(API + url)
      .set('x-csrf-token', this.csrf)
      .then(this.capture);
  }
}

export interface Harness {
  app: NestExpressApplication;
  server: unknown;
  mailer: CapturingMailer;
  users: Model<UserDoc>;
  assignments: Model<RoleAssignmentDoc>;
  close(): Promise<void>;
}

export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    MONGODB_URI: mongo.getUri('cslp-test'),
    JWT_ACCESS_SECRET: 'test-secret-'.padEnd(48, 'x'),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AI_TEXT_PROVIDER: 'fake',
    MFA_REQUIRED: 'true',
    ...env,
  });
  const mailer = new CapturingMailer();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true }),
    config,
  );
  await app.init();
  const users = app.get<Model<UserDoc>>(getModelToken(MODELS.User));
  const assignments = app.get<Model<RoleAssignmentDoc>>(getModelToken(MODELS.RoleAssignment));
  await Promise.all([users.init(), assignments.init()]);
  return {
    app,
    server: app.getHttpServer(),
    mailer,
    users,
    assignments,
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

/** Insert an active user directly (bypassing invitations) — test setup only. */
export async function createUser(
  h: Harness,
  email: string,
  opts: { role?: Role; institutionId?: string | null; accountType?: 'admin' | 'student' } = {},
) {
  const user = await h.users.create({
    email,
    passwordHash: await hashPassword(STRONG_PASSWORD),
    accountType: opts.accountType ?? 'admin',
    status: 'active',
    emailVerifiedAt: new Date(),
    profile: { firstName: 'Test', lastName: email.split('@')[0] },
  });
  if (opts.role) {
    await h.assignments.create({
      userId: user._id,
      role: opts.role,
      institutionId: opts.institutionId ?? null,
    });
  }
  return String(user._id);
}

export function totp(secret: string, offsetSteps = 0): string {
  const t = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
  return t.generate({ timestamp: Date.now() + offsetSteps * 30_000 });
}

/** Sign in a user that has no MFA yet and must enrol (super/institution admins). */
export async function loginWithEnrolment(h: Harness, email: string) {
  const c = new Client(h.server);
  let r = await c.post('/auth/login', { email, password: STRONG_PASSWORD });
  if (r.body.data?.status !== 'mfa_enrolment_required')
    throw new Error(`Unexpected login: ${JSON.stringify(r.body)}`);
  const mfaToken = r.body.data.mfaToken as string;
  r = await c.post('/auth/mfa/enrol', { mfaToken });
  const secret = r.body.data.secret as string;
  r = await c.post('/auth/mfa/confirm', { mfaToken, code: totp(secret) });
  if (r.status !== 200) throw new Error(`MFA confirm failed: ${JSON.stringify(r.body)}`);
  return { client: c, secret, recoveryCodes: r.body.data.recoveryCodes as string[] };
}

/** Sign in a user whose role does not require MFA. */
export async function login(h: Harness, email: string) {
  const c = new Client(h.server);
  const r = await c.post('/auth/login', { email, password: STRONG_PASSWORD });
  if (r.body.data?.status !== 'authenticated')
    throw new Error(`Unexpected login: ${JSON.stringify(r.body)}`);
  return c;
}
