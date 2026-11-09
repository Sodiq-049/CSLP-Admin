'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { contentGenerate, type GenerationBatch } from '@cslp/api-client';
import { GENERATABLE_KINDS, type GeneratableKind } from '@cslp/shared-types';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';
import { KIND_LABEL } from './labels';

const HINT: Record<GeneratableKind, string> = {
  notes_comprehensive: 'Full lecture notes with definitions, examples and key terms',
  notes_simplified: 'Beginner-friendly explanation with everyday analogies',
  revision_pack: 'Summary, key points, flashcards, FAQs and a checklist',
};

/** Choose outputs + options and start generation for one or more topics. Results are always drafts. */
export function GenerateForm({
  courseId,
  topicIds,
  onStarted,
}: {
  courseId: string;
  topicIds: string[];
  onStarted: (b: GenerationBatch) => void;
}) {
  const qc = useQueryClient();
  const [kinds, setKinds] = useState<GeneratableKind[]>(['notes_comprehensive']);
  const [depth, setDepth] = useState<'overview' | 'standard' | 'in_depth'>('standard');
  const [style, setStyle] = useState<'formal' | 'conversational'>('formal');
  const [examples, setExamples] = useState(3);
  const [includeCode, setIncludeCode] = useState(false);
  const [codeLanguage, setCodeLanguage] = useState('python');
  const [nigerianContext, setNigerianContext] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await contentGenerate(courseId, {
        topicIds,
        kinds,
        options: {
          depth,
          style,
          examplesCount: examples,
          includeCode,
          codeLanguage,
          nigerianContext,
        },
      });
      await invalidateAdmin(qc);
      onStarted(r.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const total = topicIds.length * kinds.length;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">What to generate</legend>
        {GENERATABLE_KINDS.map((k) => (
          <label
            key={k}
            className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 hover:bg-surface-2"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--primary)]"
              checked={kinds.includes(k)}
              onChange={(e) =>
                setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))
              }
            />
            <span>
              <span className="block text-sm font-medium">{KIND_LABEL[k]}</span>
              <span className="block text-[12.5px] text-muted">{HINT[k]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Depth">
          {(p) => (
            <Select {...p} value={depth} onChange={(e) => setDepth(e.target.value as typeof depth)}>
              <option value="overview">Overview</option>
              <option value="standard">Standard</option>
              <option value="in_depth">In depth</option>
            </Select>
          )}
        </Field>
        <Field label="Style">
          {(p) => (
            <Select {...p} value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
              <option value="formal">Formal</option>
              <option value="conversational">Conversational</option>
            </Select>
          )}
        </Field>
        <Field label="Examples">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              max={10}
              value={examples}
              onChange={(e) => setExamples(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox
          label="Use Nigerian everyday examples where helpful"
          checked={nigerianContext}
          onChange={(e) => setNigerianContext(e.target.checked)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            label="Include code examples"
            checked={includeCode}
            onChange={(e) => setIncludeCode(e.target.checked)}
          />
          {includeCode && (
            <Select
              aria-label="Programming language"
              value={codeLanguage}
              onChange={(e) => setCodeLanguage(e.target.value)}
              className="h-8 w-36 text-[13px]"
            >
              {['python', 'c', 'java', 'javascript', 'pseudocode'].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[12.5px] text-muted">
          Everything generated is saved as a draft for review. Only approved sources are used and
          cited.
        </p>
        <Button type="submit" loading={busy} disabled={!kinds.length || !topicIds.length}>
          <Sparkles className="size-4" aria-hidden /> Generate{total > 1 ? ` ${total} drafts` : ''}
        </Button>
      </div>
    </form>
  );
}
