'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';

export interface RevisionBody {
  kind: 'revision_pack';
  summary: string;
  keyPoints: { text: string; citations: string[] }[];
  flashcards: { front: string; back: string }[];
  faq: { question: string; answer: string }[];
  checklist: string[];
}

function Section({
  title,
  onAdd,
  editable,
  children,
}: {
  title: string;
  onAdd: () => void;
  editable: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {editable && (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="size-3.5" aria-hidden /> Add
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

const Remove = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <Button variant="ghost" size="sm" onClick={onClick} aria-label={label}>
    <Trash2 className="size-4" aria-hidden />
  </Button>
);

export function RevisionEditor({
  value,
  onChange,
  editable,
  citeIndex,
}: {
  value: RevisionBody;
  onChange: (v: RevisionBody) => void;
  editable: boolean;
  citeIndex: (label: string) => number | null;
}) {
  const set = <K extends keyof RevisionBody>(k: K, v: RevisionBody[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <fieldset
      disabled={!editable}
      className="flex flex-col gap-7 rounded-lg border border-border bg-surface px-5 py-5 sm:px-8"
    >
      <Field label="Summary">
        {(p) => (
          <Textarea
            {...p}
            rows={4}
            value={value.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        )}
      </Field>
      <Section
        title="Key points"
        editable={editable}
        onAdd={() => set('keyPoints', [...value.keyPoints, { text: '', citations: [] }])}
      >
        {value.keyPoints.map((k, i) => (
          <div key={i} className="flex items-start gap-2">
            <Input
              aria-label={`Key point ${i + 1}`}
              value={k.text}
              onChange={(e) =>
                set(
                  'keyPoints',
                  value.keyPoints.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                )
              }
            />
            {k.citations
              .map((c) => citeIndex(c))
              .filter(Boolean)
              .map((n) => (
                <sup key={n} className="mt-2 text-[11px] font-semibold text-primary">
                  [{n}]
                </sup>
              ))}
            {editable && (
              <Remove
                label={`Remove key point ${i + 1}`}
                onClick={() =>
                  set(
                    'keyPoints',
                    value.keyPoints.filter((_, j) => j !== i),
                  )
                }
              />
            )}
          </div>
        ))}
      </Section>
      <Section
        title="Flashcards"
        editable={editable}
        onAdd={() => set('flashcards', [...value.flashcards, { front: '', back: '' }])}
      >
        {value.flashcards.map((f, i) => (
          <div key={i} className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label={`Flashcard ${i + 1} front`}
              placeholder="Front"
              value={f.front}
              onChange={(e) =>
                set(
                  'flashcards',
                  value.flashcards.map((x, j) => (j === i ? { ...x, front: e.target.value } : x)),
                )
              }
            />
            <Input
              aria-label={`Flashcard ${i + 1} back`}
              placeholder="Back"
              value={f.back}
              onChange={(e) =>
                set(
                  'flashcards',
                  value.flashcards.map((x, j) => (j === i ? { ...x, back: e.target.value } : x)),
                )
              }
            />
            {editable && (
              <Remove
                label={`Remove flashcard ${i + 1}`}
                onClick={() =>
                  set(
                    'flashcards',
                    value.flashcards.filter((_, j) => j !== i),
                  )
                }
              />
            )}
          </div>
        ))}
      </Section>
      <Section
        title="Frequently asked questions"
        editable={editable}
        onAdd={() => set('faq', [...value.faq, { question: '', answer: '' }])}
      >
        {value.faq.map((f, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Input
                aria-label={`Question ${i + 1}`}
                placeholder="Question"
                value={f.question}
                onChange={(e) =>
                  set(
                    'faq',
                    value.faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)),
                  )
                }
              />
              <Textarea
                aria-label={`Answer ${i + 1}`}
                placeholder="Answer"
                rows={2}
                value={f.answer}
                onChange={(e) =>
                  set(
                    'faq',
                    value.faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)),
                  )
                }
              />
            </div>
            {editable && (
              <Remove
                label={`Remove question ${i + 1}`}
                onClick={() =>
                  set(
                    'faq',
                    value.faq.filter((_, j) => j !== i),
                  )
                }
              />
            )}
          </div>
        ))}
      </Section>
      <Section
        title="Revision checklist"
        editable={editable}
        onAdd={() => set('checklist', [...value.checklist, ''])}
      >
        {value.checklist.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <Input
              aria-label={`Checklist item ${i + 1}`}
              value={c}
              onChange={(e) =>
                set(
                  'checklist',
                  value.checklist.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
            />
            {editable && (
              <Remove
                label={`Remove checklist item ${i + 1}`}
                onClick={() =>
                  set(
                    'checklist',
                    value.checklist.filter((_, j) => j !== i),
                  )
                }
              />
            )}
          </div>
        ))}
      </Section>
    </fieldset>
  );
}
