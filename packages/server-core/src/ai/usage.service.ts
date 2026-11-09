import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import type { AiUsageSummary } from '@cslp/validation';
import { CORE_CONFIG, type CoreConfig } from '../config.js';
import { MODELS } from '../database/model-names.js';
import { AppError } from '../errors/app-error.js';
import { institutionFilter, type TenantScope } from '../tenancy/tenant-scope.js';
import type { InstitutionDoc } from '../academic/academic.schemas.js';
import type { AiUsageDoc } from '../sources/source.schemas.js';

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};
export const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Usage reporting and budget enforcement from the append-only ledger (docs/06 §9). */
@Injectable()
export class UsageService {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @InjectModel(MODELS.AiUsage) private readonly usage: Model<AiUsageDoc>,
    @InjectModel(MODELS.Institution) private readonly institutions: Model<InstitutionDoc>,
  ) {}

  /** Cost from configured prices only; null when any contributing model has no price. */
  private cost(
    rows: { model: string; inputTokens: number; outputTokens: number }[],
  ): number | null {
    let total = 0;
    for (const r of rows) {
      if (r.inputTokens + r.outputTokens === 0) continue;
      const p = this.config.ai.prices[r.model];
      if (!p) return null;
      total += (r.inputTokens * p.input + r.outputTokens * p.output) / 1_000_000;
    }
    return Math.round(total * 10000) / 10000;
  }

  async summary(
    scope: TenantScope,
    q: { institutionId?: string; month?: string },
  ): Promise<AiUsageSummary> {
    const month = q.month ?? currentMonth();
    const { from, to } = monthRange(month);
    const match = { ...institutionFilter(scope, q.institutionId), at: { $gte: from, $lt: to } };
    const grouped = await this.usage.aggregate<{
      _id: { task: string; model: string; day: string };
      calls: number;
      inputTokens: number;
      outputTokens: number;
      errors: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: {
            task: '$taskKey',
            model: '$model',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
          },
          calls: { $sum: 1 },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
        },
      },
    ]);
    const roll = (keyOf: (g: (typeof grouped)[number]) => string) => {
      const m = new Map<
        string,
        {
          calls: number;
          inputTokens: number;
          outputTokens: number;
          errors: number;
          parts: { model: string; inputTokens: number; outputTokens: number }[];
        }
      >();
      for (const g of grouped) {
        const k = keyOf(g);
        const r = m.get(k) ?? { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, parts: [] };
        r.calls += g.calls;
        r.inputTokens += g.inputTokens;
        r.outputTokens += g.outputTokens;
        r.errors += g.errors;
        r.parts.push({
          model: g._id.model,
          inputTokens: g.inputTokens,
          outputTokens: g.outputTokens,
        });
        m.set(k, r);
      }
      return [...m.entries()]
        .map(([key, r]) => ({
          key,
          calls: r.calls,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          errors: r.errors,
          estimatedUsd: this.cost(r.parts),
        }))
        .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
    };
    const byTask = roll((g) => g._id.task);
    const byModel = roll((g) => g._id.model);
    const all = grouped.map((g) => ({
      model: g._id.model,
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
    }));
    const days = new Map<string, { calls: number; tokens: number }>();
    for (const g of grouped) {
      const d = days.get(g._id.day) ?? { calls: 0, tokens: 0 };
      d.calls += g.calls;
      d.tokens += g.inputTokens + g.outputTokens;
      days.set(g._id.day, d);
    }
    let budgetUsd: number | null = null;
    if (q.institutionId) {
      const inst = await this.institutions
        .findById(q.institutionId, { settings: 1 })
        .lean<InstitutionDoc>();
      budgetUsd = inst?.settings.aiMonthlyBudgetUsd ? inst.settings.aiMonthlyBudgetUsd : null;
    }
    return {
      month,
      institutionId: q.institutionId ?? null,
      totals: {
        calls: grouped.reduce((n, g) => n + g.calls, 0),
        inputTokens: grouped.reduce((n, g) => n + g.inputTokens, 0),
        outputTokens: grouped.reduce((n, g) => n + g.outputTokens, 0),
        errors: grouped.reduce((n, g) => n + g.errors, 0),
        estimatedUsd: this.cost(all),
      },
      budgetUsd,
      pricesConfigured: Object.keys(this.config.ai.prices).length > 0,
      byTask,
      byModel,
      daily: [...days.entries()].sort().map(([date, d]) => ({ date, ...d })),
    };
  }

  /**
   * Refuse new AI work once the institution's monthly budget is used up (budget 0 = no limit set).
   * Only enforceable when prices are configured; otherwise usage is tracked in tokens.
   */
  async assertWithinBudget(institutionId: Types.ObjectId | string): Promise<void> {
    const inst = await this.institutions
      .findById(institutionId, { settings: 1 })
      .lean<InstitutionDoc>();
    const budget = inst?.settings.aiMonthlyBudgetUsd ?? 0;
    if (!budget) return;
    const s = await this.summary({ kind: 'all' }, { institutionId: String(institutionId) });
    if (s.totals.estimatedUsd !== null && s.totals.estimatedUsd >= budget) {
      throw new AppError(
        'BUDGET_EXCEEDED',
        `This institution has used its monthly AI budget ($${budget}). Ask a Super Administrator to raise it.`,
      );
    }
  }
}
