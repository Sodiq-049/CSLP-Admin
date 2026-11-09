import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { CreateInstitutionSchema, PageQuery, UpdateInstitutionSchema } from '@cslp/validation';
import type { z } from 'zod';
import { AppError, duplicateKeyFields } from '../errors/app-error.js';
import { MODELS } from '../database/model-names.js';
import { AuditLogService, type Actor } from '../audit/audit-log.service.js';
import { assertInstitutionAccess, type TenantScope } from '../tenancy/tenant-scope.js';
import type { InstitutionDoc } from './academic.schemas.js';

type CreateInput = z.output<typeof CreateInstitutionSchema>;
type UpdateInput = z.output<typeof UpdateInstitutionSchema>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class InstitutionsService {
  constructor(
    @InjectModel(MODELS.Institution) private readonly model: Model<InstitutionDoc>,
    private readonly audit: AuditLogService,
  ) {}

  async list(
    scope: TenantScope,
    query: PageQuery,
  ): Promise<{ items: InstitutionDoc[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (scope.kind === 'institutions')
      filter._id = { $in: scope.institutionIds.map((id) => new Types.ObjectId(id)) };
    if (!query.includeArchived) filter.archivedAt = null;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: rx }, { shortName: rx }, { slug: rx }];
    }
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ name: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<InstitutionDoc[]>(),
      this.model.countDocuments(filter),
    ]);
    return { items, total };
  }

  async get(scope: TenantScope, id: string): Promise<InstitutionDoc> {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Institution');
    assertInstitutionAccess(scope, id);
    const doc = await this.model.findById(id).lean<InstitutionDoc>();
    if (!doc) throw AppError.notFound('Institution');
    return doc;
  }

  async create(actor: Actor, input: CreateInput): Promise<InstitutionDoc> {
    try {
      const doc = await this.model.create({ ...input, settings: input.settings ?? {} });
      const obj = doc.toObject() as InstitutionDoc;
      await this.audit.record({
        actor,
        action: 'institution.create',
        target: { type: 'institution', id: doc._id },
        institutionId: doc._id,
        after: obj,
      });
      return obj;
    } catch (err) {
      if (duplicateKeyFields(err)) {
        throw AppError.conflict('An institution with this slug already exists', [
          { path: 'slug', issue: 'duplicate' },
        ]);
      }
      throw err;
    }
  }

  async update(
    actor: Actor,
    scope: TenantScope,
    id: string,
    input: UpdateInput,
  ): Promise<InstitutionDoc> {
    const before = await this.get(scope, id);
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === 'settings' && v && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) if (sv !== undefined) set[`settings.${sk}`] = sv;
      } else set[k] = v;
    }
    const after = await this.model
      .findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after', runValidators: true })
      .lean<InstitutionDoc>();
    if (!after) throw AppError.notFound('Institution');
    await this.audit.record({
      actor,
      action: 'institution.update',
      target: { type: 'institution', id },
      institutionId: id,
      before,
      after,
    });
    return after;
  }

  async archive(actor: Actor, scope: TenantScope, id: string): Promise<InstitutionDoc> {
    await this.get(scope, id);
    const after = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { archivedAt: new Date(), status: 'suspended' } },
        { returnDocument: 'after' },
      )
      .lean<InstitutionDoc>();
    await this.audit.record({
      actor,
      action: 'institution.archive',
      target: { type: 'institution', id },
      institutionId: id,
    });
    return after!;
  }
}
