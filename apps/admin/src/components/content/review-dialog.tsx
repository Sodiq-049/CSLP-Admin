'use client';

import { useState } from 'react';
import { contentReview, type ContentVersion } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

const CHECKS = [
  { key: 'accuracy', label: 'Content is academically accurate' },
  { key: 'objectivesCovered', label: 'It covers the topic and its learning objectives' },
  { key: 'citationsChecked', label: 'Citations point to the right sources' },
  { key: 'appropriateLevel', label: 'Language and depth suit the students’ level' },
] as const;
type Decision = 'approved' | 'changes_requested' | 'rejected';

export function ReviewDialog({
  version,
  open,
  onClose,
  onDone,
}: {
  version: ContentVersion;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [decision, setDecision] = useState<Decision>('approved');
  const [comment, setComment] = useState('');
  const [checks, setChecks] = useState({
    accuracy: false,
    objectivesCovered: false,
    citationsChecked: false,
    appropriateLevel: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allChecked = Object.values(checks).every(Boolean);
  const placeholder = version.generation?.provider === 'fake';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await contentReview(version.id, { decision, comment, checklist: checks });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review this version"
      description="Your decision and comments are recorded with the version."
      size="lg"
      dismissible={!busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {placeholder && (
          <Alert tone="warning">
            This version is a development placeholder, not real teaching content. It should not be
            approved.
          </Alert>
        )}
        <div
          role="radiogroup"
          aria-label="Decision"
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {(
            [
              ['approved', 'Approve'],
              ['changes_requested', 'Request changes'],
              ['rejected', 'Reject'],
            ] as const
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={decision === d}
              onClick={() => setDecision(d)}
              className={cn(
                'rounded-md border px-3 py-2 text-[13px]',
                decision === d
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-[13px] font-medium">
            Checklist{decision === 'approved' ? ' (all required to approve)' : ''}
          </legend>
          {CHECKS.map((c) => (
            <Checkbox
              key={c.key}
              label={c.label}
              checked={checks[c.key]}
              onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })}
            />
          ))}
        </fieldset>
        <Field
          label={decision === 'approved' ? 'Comment (optional)' : 'What needs to change?'}
          required={decision !== 'approved'}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={decision === 'rejected' ? 'danger' : 'primary'}
            loading={busy}
            disabled={decision === 'approved' ? !allChecked : comment.trim().length < 5}
          >
            {decision === 'approved'
              ? 'Approve'
              : decision === 'rejected'
                ? 'Reject'
                : 'Request changes'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
