'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { EDITOR_ACTIONS, type EditorAction } from '@cslp/shared-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

export const ACTION_LABEL: Record<EditorAction, string> = {
  simplify: 'Simplify',
  expand: 'Expand explanation',
  rewrite_beginner: 'Rewrite for beginners',
  add_examples: 'Add practical examples',
  grammar: 'Correct grammar',
  clarity: 'Improve clarity',
  revision_points: 'Make revision points',
};

/** Suggestion-only AI editing: nothing changes until the lecturer accepts (docs/06 §6). */
export function AiAssistDialog({
  open,
  text,
  onClose,
  onRequest,
  onAccept,
}: {
  open: boolean;
  text: string;
  onClose: () => void;
  onRequest: (action: EditorAction) => Promise<string>;
  onAccept: (suggestion: string) => void;
}) {
  const [action, setAction] = useState<EditorAction | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (a: EditorAction) => {
    setAction(a);
    setSuggestion(null);
    setError(null);
    setBusy(true);
    try {
      setSuggestion(await onRequest(a));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setAction(null);
    setSuggestion(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="AI assist"
      description="Choose what to do with the selected text. You can review the suggestion before anything changes."
      size="lg"
      dismissible={!busy}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="AI actions">
          {EDITOR_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => run(a)}
              disabled={busy}
              aria-pressed={action === a}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px]',
                action === a
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section>
            <h3 className="mb-1 text-[12.5px] font-medium text-muted">Selected text</h3>
            <p className="max-h-60 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[13px] whitespace-pre-wrap">
              {text}
            </p>
          </section>
          <section aria-live="polite">
            <h3 className="mb-1 text-[12.5px] font-medium text-muted">Suggestion</h3>
            <div className="max-h-60 min-h-24 overflow-auto rounded-md border border-primary/30 bg-primary-soft/40 p-3 text-[13px] whitespace-pre-wrap">
              {busy ? (
                <Spinner label="Thinking" />
              ) : (
                (suggestion ?? <span className="text-subtle">Pick an action.</span>)
              )}
            </div>
          </section>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Discard
          </Button>
          <Button
            onClick={() => {
              onAccept(suggestion!);
              close();
            }}
            disabled={!suggestion || busy}
          >
            <Sparkles className="size-4" aria-hidden /> Replace selection
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
