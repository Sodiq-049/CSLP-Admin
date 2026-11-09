import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { facultySchema } from '../src/academic/academic.schemas.js';
import { TenantScopeViolation } from '../src/database/tenant-plugin.js';
import { startMongo } from './mongo.js';

let stop: () => Promise<void>;
const Faculty = mongoose.model('FacultyPluginTest', facultySchema.clone());

beforeAll(async () => {
  const m = await startMongo();
  stop = m.stop;
  await mongoose.connect(m.uri);
  await Faculty.init();
});
afterAll(async () => stop());

describe('tenantScopedPlugin', () => {
  const institutionId = new Types.ObjectId();

  it('allows queries filtered by institutionId', async () => {
    await Faculty.create({ institutionId, name: 'Faculty of Science', orderKey: 'V' });
    expect(await Faculty.countDocuments({ institutionId })).toBe(1);
    expect(
      await Faculty.findOne({ $and: [{ institutionId }, { name: 'Faculty of Science' }] }),
    ).not.toBeNull();
  });

  it('rejects unscoped find / update / delete / aggregate', async () => {
    await expect(Faculty.find({ name: 'x' })).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(Faculty.findById(new Types.ObjectId())).rejects.toBeInstanceOf(
      TenantScopeViolation,
    );
    await expect(Faculty.updateMany({}, { name: 'y' })).rejects.toBeInstanceOf(
      TenantScopeViolation,
    );
    await expect(Faculty.deleteMany({})).rejects.toBeInstanceOf(TenantScopeViolation);
    await expect(Faculty.aggregate([{ $match: { name: 'x' } }]).exec()).rejects.toBeInstanceOf(
      TenantScopeViolation,
    );
  });

  it('permits explicit crossTenant opt-out', async () => {
    const all = await Faculty.find({}).setOptions({ crossTenant: true });
    expect(all.length).toBe(1);
  });
});
