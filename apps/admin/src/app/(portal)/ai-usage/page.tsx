'use client';

import { useState } from 'react';
import { useQuizzesUsageSummary, type AiUsageSummary } from '@cslp/api-client';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState, Spinner } from '@/components/ui/states';

const TASK_LABEL: Record<string, string> = {
  'notes.comprehensive': 'Comprehensive notes',
  'notes.simplified': 'Simplified notes',
  'revision.pack': 'Revision packs',
  'quiz.generate': 'Quiz questions',
  'outline.extract': 'Outline detection',
  'editor.action': 'Editor AI assist',
  'embeddings.default': 'Document indexing',
  'embeddings.query': 'Source search',
};
const n = (x: number) => x.toLocaleString('en-NG');
const usd = (x: number | null) => (x === null ? '—' : `$${x.toFixed(x < 1 ? 4 : 2)}`);

function UsageTable({
  title,
  rows,
  label,
}: {
  title: string;
  rows: AiUsageSummary['byTask'];
  label: (k: string) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.inputTokens + r.outputTokens));
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title="No usage this month" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-[12px] text-muted uppercase">
                <th scope="col" className="px-4 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Calls
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Tokens (in / out)
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Est. cost
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{label(r.key)}</div>
                    {r.errors > 0 && (
                      <div className="text-[12px] text-danger">
                        {r.errors} failed call{r.errors === 1 ? '' : 's'}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{n(r.calls)}</td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-3"
                        aria-hidden
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${((r.inputTokens + r.outputTokens) / max) * 100}%` }}
                        />
                      </div>
                      <span className="text-[12.5px] text-muted tabular-nums">
                        {n(r.inputTokens)} / {n(r.outputTokens)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.estimatedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Usage({ institutionId }: { institutionId: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuizzesUsageSummary({ institutionId, month });
  const s = q.data?.data;
  const pct =
    s?.budgetUsd && s.totals.estimatedUsd !== null
      ? Math.min(100, (s.totals.estimatedUsd / s.budgetUsd) * 100)
      : null;
  return (
    <>
      <PageHeader
        title="AI usage & costs"
        description="Every AI call is recorded. Costs are estimates from configured prices; the provider’s invoice is authoritative."
        actions={
          <label className="flex items-center gap-2 text-[13px] text-muted">
            Month{' '}
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-8 w-40"
            />
          </label>
        }
      />
      {q.isLoading || !s ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          {!s.pricesConfigured && (
            <Alert tone="info">
              Token usage is shown below. To see estimated costs and enforce budgets, set
              AI_PRICES_JSON with your OpenAI prices (USD per 1M tokens).
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['AI calls', n(s.totals.calls)],
              ['Input tokens', n(s.totals.inputTokens)],
              ['Output tokens', n(s.totals.outputTokens)],
              ['Estimated cost', s.pricesConfigured ? usd(s.totals.estimatedUsd) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                <div className="text-[12.5px] text-muted">{label}</div>
                <div className="mt-1 text-2xl font-semibold text-fg tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <Card>
            <CardHeader
              title="Monthly budget"
              description={
                s.budgetUsd
                  ? `Set in the institution’s settings. New AI work is blocked once it is reached.`
                  : 'No budget is set for this institution. Set one on the institution page.'
              }
            />
            {s.budgetUsd && (
              <div className="px-5 py-4">
                <div className="mb-1.5 flex justify-between text-[13px]">
                  <span>{usd(s.totals.estimatedUsd)} used</span>
                  <span className="text-muted">of {usd(s.budgetUsd)}</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-3"
                  role="progressbar"
                  aria-valuenow={pct ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Budget used"
                >
                  <div
                    className={
                      pct !== null && pct >= 80
                        ? 'h-full rounded-full bg-warning'
                        : 'h-full rounded-full bg-success'
                    }
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              </div>
            )}
          </Card>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <UsageTable title="By feature" rows={s.byTask} label={(k) => TASK_LABEL[k] ?? k} />
            <UsageTable title="By model" rows={s.byModel} label={(k) => k} />
          </div>
        </div>
      )}
    </>
  );
}

export default function AiUsagePage() {
  return (
    <RequireInstitution>{(i) => <Usage key={i.id} institutionId={i.id} />}</RequireInstitution>
  );
}
