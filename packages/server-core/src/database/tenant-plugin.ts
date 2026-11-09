import type { Schema } from 'mongoose';

/**
 * Defence in depth for institution isolation (docs/03 §4.5).
 * Any query on a tenant-scoped model must filter by `institutionId`, unless the caller
 * explicitly opts out with `.setOptions({ crossTenant: true })` — reserved for trusted code
 * paths (scope resolution, super-admin views) that are reviewed individually.
 */
export class TenantScopeViolation extends Error {
  constructor(model: string, op: string) {
    super(`Tenant scope violation: ${op} on ${model} without institutionId filter`);
    this.name = 'TenantScopeViolation';
  }
}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const;

function hasInstitutionFilter(filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return false;
  if (filter.institutionId !== undefined && filter.institutionId !== null) return true;
  const and = filter.$and;
  return Array.isArray(and) && and.some((f) => hasInstitutionFilter(f as Record<string, unknown>));
}

export function tenantScopedPlugin(schema: Schema): void {
  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      // `this` is a Query
      const q = this as unknown as {
        getFilter(): Record<string, unknown>;
        getOptions(): { crossTenant?: boolean };
        model: { modelName: string };
      };
      if (q.getOptions().crossTenant) return;
      if (!hasInstitutionFilter(q.getFilter()))
        throw new TenantScopeViolation(q.model.modelName, op);
    });
  }
  schema.pre('aggregate', function () {
    const agg = this as unknown as {
      pipeline(): Record<string, unknown>[];
      options: { crossTenant?: boolean };
      model(): { modelName: string };
    };
    if (agg.options?.crossTenant) return;
    const first = agg.pipeline()[0] ?? {};
    const match = (first.$match ?? (first.$vectorSearch as { filter?: unknown })?.filter) as
      Record<string, unknown> | undefined;
    if (!hasInstitutionFilter(match))
      throw new TenantScopeViolation(agg.model().modelName, 'aggregate');
  });
}
