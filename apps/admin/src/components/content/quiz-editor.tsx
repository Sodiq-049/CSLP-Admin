'use client';

import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useQuizzesQuizQuestions } from '@cslp/api-client';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/states';
import { QuestionView, TYPE_LABEL } from './question-ui';

export interface QuizBody {
  kind: 'quiz';
  questionRefs: { questionId: string; lineageId: string; revision: number }[];
  settings: { shuffle: boolean; timeLimitMinutes: number | null; passMarkPercent: number };
}

/** Quiz drafts: reorder, remove and settings. Questions are pinned to approved revisions. */
export function QuizEditor({
  versionId,
  value,
  onChange,
  editable,
}: {
  versionId: string;
  value: QuizBody;
  onChange: (v: QuizBody) => void;
  editable: boolean;
}) {
  const questions = useQuizzesQuizQuestions(versionId);
  const byId = new Map((questions.data?.data ?? []).map((q) => [q.id, q]));
  const move = (i: number, d: -1 | 1) => {
    const refs = [...value.questionRefs];
    [refs[i], refs[i + d]] = [refs[i + d]!, refs[i]!];
    onChange({ ...value, questionRefs: refs });
  };
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Quiz settings" />
        <fieldset disabled={!editable} className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3">
          <Field label="Pass mark (%)">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100}
                value={value.settings.passMarkPercent}
                onChange={(e) =>
                  onChange({
                    ...value,
                    settings: {
                      ...value.settings,
                      passMarkPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    },
                  })
                }
              />
            )}
          </Field>
          <Field label="Time limit (minutes)" hint="Leave empty for no limit">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                max={240}
                value={value.settings.timeLimitMinutes ?? ''}
                onChange={(e) =>
                  onChange({
                    ...value,
                    settings: {
                      ...value.settings,
                      timeLimitMinutes: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
            )}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              label="Shuffle question order"
              checked={value.settings.shuffle}
              onChange={(e) =>
                onChange({ ...value, settings: { ...value.settings, shuffle: e.target.checked } })
              }
            />
          </div>
        </fieldset>
      </Card>
      <Card>
        <CardHeader
          title={`Questions (${value.questionRefs.length})`}
          description="Each question is pinned to the approved revision shown here."
        />
        {questions.isLoading ? (
          <Spinner />
        ) : (
          <ol className="divide-y divide-border">
            {value.questionRefs.map((r, i) => {
              const q = byId.get(r.questionId);
              return (
                <li key={r.questionId} className="flex gap-3 px-5 py-4">
                  <span className="w-6 shrink-0 text-right text-[12px] text-subtle tabular-nums">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    {q ? (
                      <>
                        <p className="mb-1 text-[12px] text-muted">
                          {TYPE_LABEL[q.type]} · {q.difficulty} · rev {r.revision}
                        </p>
                        <QuestionView q={q} />
                      </>
                    ) : (
                      <p className="text-muted">Question unavailable</p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex shrink-0 flex-col">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`Move question ${i + 1} up`}
                        className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30"
                      >
                        <ArrowUp className="size-4" aria-hidden />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === value.questionRefs.length - 1}
                        aria-label={`Move question ${i + 1} down`}
                        className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30"
                      >
                        <ArrowDown className="size-4" aria-hidden />
                      </button>
                      <button
                        onClick={() =>
                          onChange({
                            ...value,
                            questionRefs: value.questionRefs.filter((_, j) => j !== i),
                          })
                        }
                        disabled={value.questionRefs.length === 1}
                        aria-label={`Remove question ${i + 1}`}
                        className="rounded p-1.5 text-muted hover:bg-surface-2 disabled:opacity-30"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
