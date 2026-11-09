import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AdminPasswordSchema,
  CreateCurriculumVersionSchema,
  CreateInstitutionSchema,
  InviteAdminRequestSchema,
  PageQuerySchema,
  requestRegistry,
  responseRegistry,
} from './index.js';

describe('contract registries', () => {
  it('every contract id is unique across requests and responses', () => {
    const ids: string[] = [];
    for (const reg of [requestRegistry, responseRegistry]) {
      const json = z.toJSONSchema(reg, { uri: (id) => id, unrepresentable: 'any' });
      ids.push(...Object.keys(json.schemas));
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('AdminPasswordSchema', () => {
  it.each([
    ['short1A', false],
    ['alllowercase123', false],
    ['NoDigitsHereAtAll', false],
    ['Correct-Horse-9-Battery', true],
  ])('%s → %s', (pw, ok) => {
    expect(AdminPasswordSchema.safeParse(pw).success).toBe(ok);
  });
});

describe('InviteAdminRequestSchema', () => {
  const inst = 'a'.repeat(24);
  it('super_admin must be global; other roles need an institution', () => {
    expect(
      InviteAdminRequestSchema.safeParse({ email: 'a@b.co', role: 'super_admin' }).success,
    ).toBe(true);
    expect(
      InviteAdminRequestSchema.safeParse({
        email: 'a@b.co',
        role: 'super_admin',
        institutionId: inst,
      }).success,
    ).toBe(false);
    expect(
      InviteAdminRequestSchema.safeParse({ email: 'a@b.co', role: 'content_manager' }).success,
    ).toBe(false);
    expect(
      InviteAdminRequestSchema.safeParse({
        email: 'A@B.co ',
        role: 'content_manager',
        institutionId: inst,
      }).data?.email,
    ).toBe('a@b.co');
  });
});

describe('PageQuerySchema', () => {
  it('coerces query-string values and applies defaults', () => {
    expect(PageQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(
      PageQuerySchema.parse({ page: '3', pageSize: '50', includeArchived: 'true' }),
    ).toMatchObject({
      page: 3,
      pageSize: 50,
      includeArchived: true,
    });
    expect(PageQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('academic contracts', () => {
  it('normalises institution slug and country', () => {
    const r = CreateInstitutionSchema.parse({
      name: 'Yaba College of Technology',
      shortName: 'YABATECH',
      slug: 'YabaTech',
      country: 'ng',
    });
    expect(r.slug).toBe('yabatech');
    expect(r.country).toBe('NG');
    expect(r.timezone).toBe('Africa/Lagos');
  });
  it('requires an academic session format', () => {
    expect(
      CreateCurriculumVersionSchema.safeParse({ label: 'Current', effectiveFromSession: '2024' })
        .success,
    ).toBe(false);
    expect(
      CreateCurriculumVersionSchema.safeParse({
        label: 'Current',
        effectiveFromSession: '2024/2025',
      }).success,
    ).toBe(true);
  });
});
