'use client';

import type { JSONContent } from '@tiptap/core';
import { Eye } from 'lucide-react';
import { usePublishingPreview, type StudentMaterial } from '@cslp/api-client';
import { RichEditor } from '@/components/content/rich-editor';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ErrorState, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

/** Renders exactly what the student API returns for a version (same serializer). */
export function StudentView({ m }: { m: StudentMaterial }) {
  const c = m.content;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12.5px] text-muted">
        {m.course.code} · {m.topic.title}
        {m.aiAssisted ? ' · prepared with AI assistance and reviewed by staff' : ''}
      </div>
      {c.kind === 'notes' && (
        <RichEditor label="Student preview" content={c.doc as JSONContent} editable={false} />
      )}
      {c.kind === 'revision_pack' && (
        <div className="flex flex-col gap-4 text-sm">
          <p>{c.summary}</p>
          <section>
            <h3 className="mb-1 font-semibold">Key points</h3>
            <ul className="list-disc space-y-1 pl-5">
              {c.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Flashcards</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {c.flashcards.map((f, i) => (
                <li key={i} className="rounded-md border border-border p-3">
                  <div className="font-medium">{f.front}</div>
                  <div className="mt-1 text-muted">{f.back}</div>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">FAQs</h3>
            <dl className="space-y-2">
              {c.faq.map((f, i) => (
                <div key={i}>
                  <dt className="font-medium">{f.question}</dt>
                  <dd className="text-muted">{f.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
      {c.kind === 'quiz' && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            Pass mark {c.settings.passMarkPercent}%
            {c.settings.timeLimitMinutes ? ` · ${c.settings.timeLimitMinutes} minutes` : ''}
            {c.settings.shuffle ? ' · questions shuffled' : ''}
          </p>
          <Alert tone="info">
            Students never receive the answers; quizzes are marked on the server.
          </Alert>
          <ol className="list-decimal space-y-3 pl-5">
            {c.questions.map((q) => (
              <li key={q.id}>
                <p className="font-medium">{q.stem}</p>
                {q.options.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {q.options.map((o) => (
                      <li key={o.id} className="flex items-center gap-2">
                        <span
                          className="size-3.5 rounded-full border border-border-strong"
                          aria-hidden
                        />
                        {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                {q.options.length === 0 && (
                  <div
                    className="mt-1 h-8 rounded border border-dashed border-border"
                    aria-label="Answer box"
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {m.citations.length > 0 && (
        <section className="border-t border-border pt-3 text-[12.5px] text-muted">
          <h3 className="mb-1 font-semibold text-fg">Sources</h3>
          <ol>
            {m.citations.map((c2) => (
              <li key={c2.index}>
                [{c2.index}] {c2.sourceTitle}
                {c2.page ? `, p. ${c2.page}` : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function StudentPreviewDialog({
  versionId,
  open,
  onClose,
}: {
  versionId: string;
  open: boolean;
  onClose: () => void;
}) {
  const q = usePublishingPreview(versionId, { query: { enabled: open } });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Preview as student"
      description={
        <span className="inline-flex items-center gap-1">
          <Eye className="size-3.5" aria-hidden /> Exactly what students receive from the student
          API for this version.
        </span>
      }
      size="lg"
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error || !q.data ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : (
        <StudentView m={q.data.data} />
      )}
    </Dialog>
  );
}
