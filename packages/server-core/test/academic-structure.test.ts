import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { CreateInstitutionSchema, PageQuerySchema } from '@cslp/validation';
import {
  AcademicStructureService,
  AppError,
  InstitutionsService,
  ServerCoreModule,
  type Actor,
  type TenantScope,
} from '../src/index.js';
import { startMongo } from './mongo.js';
import { TEST_CORE_CONFIG } from './core-config.js';

const actor: Actor = { userId: null, roles: ['test'] };
const ALL: TenantScope = { kind: 'all' };
const page = PageQuerySchema.parse({});

let stop: () => Promise<void>;
let institutions: InstitutionsService;
let academic: AcademicStructureService;
let close: () => Promise<void>;

beforeAll(async () => {
  const m = await startMongo();
  const mod = await Test.createTestingModule({
    imports: [MongooseModule.forRoot(m.uri), ServerCoreModule.forRoot(TEST_CORE_CONFIG)],
  }).compile();
  const app = mod.createNestApplication();
  await app.init();
  institutions = app.get(InstitutionsService);
  academic = app.get(AcademicStructureService);
  close = async () => {
    await app.close();
    await m.stop();
  };
  stop = close;
});
afterAll(async () => stop());

const mkInstitution = (slug: string) =>
  institutions.create(
    actor,
    CreateInstitutionSchema.parse({ name: `Inst ${slug}`, shortName: slug.toUpperCase(), slug }),
  );

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe('AcademicStructureService', () => {
  it('builds the full hierarchy and tree', async () => {
    const inst = await mkInstitution('yabatech-demo');
    const id = String(inst._id);
    const fac = await academic.createFaculty(actor, ALL, id, { name: 'School of Technology' });
    const dept = await academic.createDepartment(actor, ALL, id, {
      facultyId: String(fac._id),
      name: 'Computer Science',
      code: 'csc',
    });
    expect(dept.code).toBe('CSC');
    const nd = await academic.createProgramme(actor, ALL, id, {
      departmentId: String(dept._id),
      name: 'National Diploma in Computer Science',
      award: 'ND',
      code: 'ND-CS',
      durationLevels: 2,
    });
    expect(String(nd.facultyId)).toBe(String(fac._id)); // denormalised ancestor
    await academic.createLevel(actor, ALL, String(nd._id), { name: 'ND 1', code: 'ND1', rank: 1 });
    await academic.createLevel(actor, ALL, String(nd._id), { name: 'ND 2', code: 'ND2', rank: 2 });
    await academic.createSemester(actor, ALL, id, { name: 'First Semester', code: 'S1', rank: 1 });

    const tree = await academic.getTree(ALL, id);
    expect(tree.faculties[0]!.departments[0]!.programmes[0]!.levels.map((l) => l.code)).toEqual([
      'ND1',
      'ND2',
    ]);
    expect(tree.semesters).toHaveLength(1);
  });

  it('rejects duplicate codes within an institution but allows them across institutions', async () => {
    const a = await mkInstitution('inst-a');
    const b = await mkInstitution('inst-b');
    for (const inst of [a, b]) {
      const fac = await academic.createFaculty(actor, ALL, String(inst._id), { name: 'Science' });
      await academic.createDepartment(actor, ALL, String(inst._id), {
        facultyId: String(fac._id),
        name: 'Computer Science',
        code: 'CSC',
      });
    }
    const fac = (await academic.listFaculties(ALL, String(a._id), page)).items[0]!;
    await expectAppError(
      academic.createDepartment(actor, ALL, String(a._id), {
        facultyId: String(fac._id),
        name: 'Computing',
        code: 'CSC',
      }),
      'CONFLICT',
    );
  });

  it('enforces institution isolation', async () => {
    const a = await mkInstitution('iso-a');
    const b = await mkInstitution('iso-b');
    const facB = await academic.createFaculty(actor, ALL, String(b._id), { name: 'Engineering' });
    const scopeA: TenantScope = { kind: 'institutions', institutionIds: [String(a._id)] };

    // cannot list, update or archive another institution's data
    await expectAppError(academic.listFaculties(scopeA, String(b._id), page), 'NOT_FOUND');
    await expectAppError(
      academic.updateFaculty(actor, scopeA, String(facB._id), { name: 'X' }),
      'NOT_FOUND',
    );
    await expectAppError(academic.archiveFaculty(actor, scopeA, String(facB._id)), 'NOT_FOUND');

    // cannot attach a parent from another institution
    await expectAppError(
      academic.createDepartment(actor, scopeA, String(a._id), {
        facultyId: String(facB._id),
        name: 'Sneaky',
        code: 'SNK',
      }),
      'VALIDATION_FAILED',
    );

    // institutions list is scoped
    const visible = await institutions.list(scopeA, page);
    expect(visible.items.map((i) => i.slug)).toEqual(['iso-a']);
  });

  it('blocks archiving a faculty with active departments; cascades programme → levels', async () => {
    const inst = await mkInstitution('archive-test');
    const id = String(inst._id);
    const fac = await academic.createFaculty(actor, ALL, id, { name: 'Science' });
    const dept = await academic.createDepartment(actor, ALL, id, {
      facultyId: String(fac._id),
      name: 'CS',
      code: 'CS',
    });
    await expectAppError(academic.archiveFaculty(actor, ALL, String(fac._id)), 'CONFLICT');

    const prog = await academic.createProgramme(actor, ALL, id, {
      departmentId: String(dept._id),
      name: 'HND CS',
      award: 'HND',
      code: 'HND-CS',
      durationLevels: 2,
    });
    await academic.createLevel(actor, ALL, String(prog._id), {
      name: 'HND 1',
      code: 'HND1',
      rank: 1,
    });
    await academic.archiveProgramme(actor, ALL, String(prog._id));
    const levels = await academic.listLevels(ALL, String(prog._id), page);
    expect(levels.total).toBe(0);
    await academic.archiveDepartment(actor, ALL, String(dept._id));
    const archived = await academic.archiveFaculty(actor, ALL, String(fac._id));
    expect(archived.archivedAt).toBeInstanceOf(Date);
  });

  it('keeps only one current curriculum version per programme', async () => {
    const inst = await mkInstitution('curr-test');
    const id = String(inst._id);
    const v1 = await academic.createCurriculumVersion(actor, ALL, id, {
      label: '2019 Curriculum',
      effectiveFromSession: '2019/2020',
      isCurrent: true,
    });
    await academic.createCurriculumVersion(actor, ALL, id, {
      label: '2024 Curriculum',
      effectiveFromSession: '2024/2025',
      isCurrent: true,
    });
    const list = await academic.listCurriculumVersions(ALL, id, page);
    const current = list.items.filter((c) => c.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.label).toBe('2024 Curriculum');
    expect(list.items.find((c) => String(c._id) === String(v1._id))!.isCurrent).toBe(false);
  });
});
