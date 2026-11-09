'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { quizzesCompose, useQuizzesList } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Alert, EmptyState, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';
import { TYPE_LABEL } from './question-ui';

export function ComposeQuizDialog({
  topicId,
  open,
  onClose,
}: {
  topicId: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const approved = useQuizzesList(
    { topicId, status: 'approved', pageSize: 100 },
    { query: { enabled: open } },
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [passMark, setPassMark] = useState(50);
  const [timeLimit, setTimeLimit] = useState('');
  const [shuffle, setShuffle] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = approved.data?.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a quiz"
      description="Choose approved questions. The quiz is saved as a draft and goes through review like other content."
      size="lg"
      dismissible={!busy}
    >
      {approved.isLoading ? (
        <Spinner />
      ) : qs.length === 0 ? (
        <EmptyState
          title="No approved questions for this topic"
          body="Generate questions from approved notes, then approve them in Quiz Management."
        />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await quizzesCompose(topicId, {
                questionIds: selected,
                settings: {
                  shuffle,
                  passMarkPercent: passMark,
                  timeLimitMinutes: timeLimit ? Number(timeLimit) : null,
                },
              });
              await invalidateAdmin(qc);
              router.push(`/content/versions/${r.data.id}`);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
            <legend className="px-1 text-[13px] font-medium">
              Approved questions ({selected.length} of {qs.length} selected)
            </legend>
            {qs.map((q) => (
              <label key={q.id} className="flex cursor-pointer items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={selected.includes(q.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, q.id] : selected.filter((x) => x !== q.id),
                    )
                  }
                />
                <span>
                  <span className="font-medium">{q.stem}</span>{' '}
                  <span className="text-muted">
                    · {TYPE_LABEL[q.type]} · {q.difficulty}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Pass mark (%)" className="w-32">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  value={passMark}
                  onChange={(e) =>
                    setPassMark(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                />
              )}
            </Field>
            <Field label="Time limit (min)" className="w-36">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={240}
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(e.target.value)}
                  placeholder="None"
                />
              )}
            </Field>
            <Checkbox
              label="Shuffle questions"
              checked={shuffle}
              onChange={(e) => setShuffle(e.target.checked)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!selected.length}>
              Create quiz draft
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
