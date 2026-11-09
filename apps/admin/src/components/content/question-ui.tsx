'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  quizzesGenerate,
  quizzesReview,
  quizzesUpdate,
  useSourcesJob,
  type Question,
} from '@cslp/api-client';
import { DIFFICULTIES, QUESTION_TYPES, type QuestionType } from '@cslp/shared-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

export const TYPE_LABEL: Record<QuestionType, string> = {
  mcq_single: 'Multiple choice',
  true_false: 'True / false',
  fill_gap: 'Fill in the gap',
  short_answer: 'Short answer',
};

export function QuestionStatusBadge({ q }: { q: Pick<Question, 'reviewStatus' | 'duplicateOf'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {q.reviewStatus === 'approved' ? (
        <Badge tone="success">Approved</Badge>
      ) : q.reviewStatus === 'rejected' ? (
        <Badge tone="danger">Rejected</Badge>
      ) : (
        <Badge>Draft</Badge>
      )}
      {q.duplicateOf && (
        <Badge tone="warning">
          <Copy className="size-3" aria-hidden /> Possible duplicate
        </Badge>
      )}
    </span>
  );
}

/** Read-only rendering of a question with its answer. */
export function QuestionView({ q }: { q: Question }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px]">
      <p className="font-medium whitespace-pre-wrap">{q.stem}</p>
      {q.options.length > 0 && (
        <ul className="flex flex-col gap-1">
          {q.options.map((o) => (
            <li
              key={o.id}
              className={
                o.isCorrect
                  ? 'flex items-center gap-2 font-medium text-success'
                  : 'flex items-center gap-2 text-muted'
              }
            >
              {o.isCorrect ? (
                <Check className="size-3.5" aria-label="Correct answer" />
              ) : (
                <span className="size-3.5" aria-hidden />
              )}{' '}
              {o.text}
            </li>
          ))}
        </ul>
      )}
      {q.acceptedAnswers.length > 0 && (
        <p className="text-muted">
          <span className="font-medium text-fg">
            {q.type === 'short_answer' ? 'Key points: ' : 'Accepted answers: '}
          </span>
          {q.acceptedAnswers.join('; ')}
        </p>
      )}
      {q.explanation && (
        <p className="rounded-md bg-surface-2 p-2 text-[12.5px] text-muted">{q.explanation}</p>
      )}
    </div>
  );
}

/** Edit (drafts in place; approved → new revision) and review a question. */
export function QuestionDialog({
  question,
  onClose,
}: {
  question: Question | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [q, setQ] = useState<Question | null>(question);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQ(question);
    setComment('');
    setError(null);
  }, [question]);
  const canEdit = useCan('quiz.manage', undefined);
  const canReview = useCan('question.review', undefined);
  if (!q) return null;
  const isAuthor = q.createdBy === me.id;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await invalidateAdmin(qc);
      toast.success(msg);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const editable = canEdit && q.isLatest;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${TYPE_LABEL[q.type]} · revision ${q.revision}`}
      description={<QuestionStatusBadge q={q} />}
      size="lg"
      dismissible={!busy}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {q.provider === 'fake' && (
          <Alert tone="warning">
            Development placeholder question. Do not approve it as a real assessment item.
          </Alert>
        )}
        {q.reviewStatus !== 'draft' && editable && (
          <Alert tone="info">
            Saving changes creates a new draft revision; the {q.reviewStatus} revision stays as it
            was.
          </Alert>
        )}
        <fieldset disabled={!editable} className="flex flex-col gap-3">
          <Field label="Question">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={q.stem}
                onChange={(e) => setQ({ ...q, stem: e.target.value })}
              />
            )}
          </Field>
          {(q.type === 'mcq_single' || q.type === 'true_false') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium">
                Options (select the correct one)
              </legend>
              {q.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct"
                    aria-label={`Mark option ${i + 1} correct`}
                    checked={o.isCorrect}
                    onChange={() =>
                      setQ({
                        ...q,
                        options: q.options.map((x) => ({ ...x, isCorrect: x.id === o.id })),
                      })
                    }
                    className="size-4 accent-[var(--success)]"
                  />
                  <Input
                    aria-label={`Option ${i + 1}`}
                    value={o.text}
                    disabled={q.type === 'true_false'}
                    onChange={(e) =>
                      setQ({
                        ...q,
                        options: q.options.map((x) =>
                          x.id === o.id ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          )}
          {(q.type === 'fill_gap' || q.type === 'short_answer') && (
            <Field
              label={
                q.type === 'short_answer'
                  ? 'Key points (one per line)'
                  : 'Accepted answers (one per line)'
              }
            >
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={q.acceptedAnswers.join('\n')}
                  onChange={(e) => setQ({ ...q, acceptedAnswers: e.target.value.split('\n') })}
                />
              )}
            </Field>
          )}
          <Field label="Explanation">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={q.explanation}
                onChange={(e) => setQ({ ...q, explanation: e.target.value })}
              />
            )}
          </Field>
          <Field label="Difficulty" className="max-w-40">
            {(p) => (
              <Select
                {...p}
                value={q.difficulty}
                onChange={(e) =>
                  setQ({ ...q, difficulty: e.target.value as Question['difficulty'] })
                }
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
        {q.reviewStatus === 'draft' && q.isLatest && canReview && !isAuthor && (
          <Field label="Review comment" hint="Required when rejecting.">
            {(p) => <Input {...p} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        )}
        {q.reviewStatus === 'draft' && canReview && isAuthor && (
          <p className="text-[12.5px] text-muted">
            You created or edited this question, so another reviewer must approve it.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          {editable && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() =>
                run(
                  () =>
                    quizzesUpdate(q.id, {
                      stem: q.stem,
                      options: q.options,
                      acceptedAnswers: q.acceptedAnswers.map((a) => a.trim()).filter(Boolean),
                      explanation: q.explanation,
                      difficulty: q.difficulty,
                    }),
                  q.reviewStatus === 'draft' ? 'Question saved' : 'New revision created',
                )
              }
            >
              Save changes
            </Button>
          )}
          {q.reviewStatus === 'draft' && q.isLatest && canReview && !isAuthor && (
            <>
              <Button
                variant="danger"
                loading={busy}
                disabled={comment.trim().length < 3}
                onClick={() =>
                  run(
                    () => quizzesReview(q.id, { decision: 'rejected', comment }),
                    'Question rejected',
                  )
                }
              >
                <X className="size-4" aria-hidden /> Reject
              </Button>
              <Button
                loading={busy}
                onClick={() =>
                  run(
                    () => quizzesReview(q.id, { decision: 'approved', comment }),
                    'Question approved',
                  )
                }
              >
                <Check className="size-4" aria-hidden /> Approve
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Generate questions from approved notes, then show job progress. */
export function GenerateQuestionsDialog({
  versionId,
  open,
  onClose,
}: {
  versionId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<QuestionType[]>(['mcq_single', 'true_false']);
  const [difficulty, setDifficulty] = useState<'mixed' | 'easy' | 'medium' | 'hard'>('mixed');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useSourcesJob(jobId ?? '', {
    query: {
      enabled: !!jobId,
      refetchInterval: (s) =>
        s.state.data && ['completed', 'failed'].includes(s.state.data.data.status) ? false : 1500,
    },
  });
  const j = job.data?.data;
  return (
    <Dialog
      open={open}
      onClose={() => {
        setJobId(null);
        onClose();
      }}
      title="Generate questions"
      description="Questions are drawn only from these approved notes and saved as drafts for review."
      size="md"
    >
      {jobId ? (
        <div className="flex flex-col gap-3 text-sm" aria-live="polite">
          {j?.status === 'completed' ? (
            <Alert tone="success">
              {j.progress.message ?? 'Questions created.'} Review them in Quiz Management.
            </Alert>
          ) : j?.status === 'failed' ? (
            <Alert tone="danger">{j.error}</Alert>
          ) : (
            <p className="text-muted">Writing questions… ({j?.progress.stage ?? 'queued'})</p>
          )}
          <div className="flex justify-end gap-2">
            {j?.status === 'completed' && (
              <a href="/quizzes">
                <Button>Open Quiz Management</Button>
              </a>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                setJobId(null);
                onClose();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setJobId((await quizzesGenerate(versionId, { count, types, difficulty })).data.jobId);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium">Question types</legend>
            {QUESTION_TYPES.map((t) => (
              <Checkbox
                key={t}
                label={TYPE_LABEL[t]}
                checked={types.includes(t)}
                onChange={(e) =>
                  setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))
                }
              />
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={30}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                />
              )}
            </Field>
            <Field label="Difficulty">
              {(p) => (
                <Select
                  {...p}
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
                >
                  <option value="mixed">Mixed</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={busy} disabled={!types.length}>
              Generate
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
