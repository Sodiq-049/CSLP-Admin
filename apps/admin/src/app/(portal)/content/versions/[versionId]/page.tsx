'use client';

import type { JSONContent } from '@tiptap/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  FileClock,
  Loader2,
  Send,
  Sparkles,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  contentFork,
  contentSubmit,
  contentUpdate,
  contentWithdraw,
  quizzesAiAction,
  useContentGet,
  useContentMaterials,
  type ContentVersion,
} from '@cslp/api-client';
import { DisplayStatusBadge, KIND_LABEL, VersionStatusBadge } from '@/components/content/labels';
import { ReviewDialog } from '@/components/content/review-dialog';
import { RevisionEditor, type RevisionBody } from '@/components/content/revision-editor';
import { RichEditor } from '@/components/content/rich-editor';
import { GenerateQuestionsDialog } from '@/components/content/question-ui';
import { QuizEditor, type QuizBody } from '@/components/content/quiz-editor';
import { PublishActionDialog, type PublishAction } from '@/components/publishing/publish-dialogs';
import { StudentPreviewDialog } from '@/components/publishing/student-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage, hasCode } from '@/lib/errors';
import { fmtDate, invalidateAdmin } from '@/lib/query';

type Body = NonNullable<ContentVersion['body']>;
type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

/** Debounced autosave with optimistic concurrency (autosaveRev). */
function useAutosave(version: ContentVersion | undefined, editable: boolean) {
  const [state, setState] = useState<SaveState>('idle');
  const rev = useRef(version?.autosaveRev ?? 0);
  const pending = useRef<Body | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (version) rev.current = version.autosaveRev;
  }, [version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    if (!version || !pending.current || state === 'conflict') return;
    const body = pending.current;
    pending.current = null;
    setState('saving');
    try {
      const r = await contentUpdate(version.id, { autosaveRev: rev.current, body });
      rev.current = r.data.autosaveRev;
      setState('saved');
    } catch (err) {
      setState(hasCode(err, 'PRECONDITION_FAILED') ? 'conflict' : 'error');
    }
  }, [version, state]);

  const queue = useCallback(
    (body: Body) => {
      if (!editable) return;
      pending.current = body;
      setState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 1200);
    },
    [editable, flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return { state, queue, flush };
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] text-muted" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
      </span>
    );
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] text-success" role="status">
        <CheckCircle2 className="size-3.5" aria-hidden /> Saved
      </span>
    );
  if (state === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-[12.5px] text-danger" role="status">
        <CloudOff className="size-3.5" aria-hidden /> Not saved, retrying on next change
      </span>
    );
  return null;
}

export default function VersionPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const query = useContentGet(versionId, {
    query: {
      refetchInterval: (q) =>
        q.state.data && ['queued', 'generating'].includes(q.state.data.data.generationStatus)
          ? 2000
          : false,
    },
  });
  const v = query.data?.data;
  const materials = useContentMaterials(v?.topicId ?? '', { query: { enabled: !!v } });
  const material = materials.data?.data.find((m) => m.id === v?.materialId);
  const inst = v?.context.institutionId;
  const canEdit = useCan('content.edit', inst);
  const canSubmit = useCan('content.submit_review', inst);
  const canReview = useCan('content.review', inst);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState<RevisionBody | null>(null);
  const [quiz, setQuiz] = useState<QuizBody | null>(null);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const canManageQuiz = useCan('quiz.manage', inst);
  const canGenerate = useCan('content.generate', inst);
  const canPublish = useCan('content.publish', inst);
  const [previewing, setPreviewing] = useState(false);
  const [publishAction, setPublishAction] = useState<PublishAction | null>(null);

  const ready = v && ['none', 'generated'].includes(v.generationStatus);
  const editable = !!v && canEdit && ready && v.reviewStatus === 'draft' && !v.frozen;
  const { state: saveState, queue: queueSave, flush } = useAutosave(v, !!editable);

  useEffect(() => {
    if (v?.body?.kind === 'revision_pack') setRevision(v.body as RevisionBody);
    if (v?.body?.kind === 'quiz') setQuiz(v.body as QuizBody);
  }, [v?.id, v?.body?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) return <Spinner />;
  if (query.error || !v)
    return (
      <ErrorState
        message={errorMessage(query.error, 'Version not found.')}
        onRetry={() => query.refetch()}
      />
    );

  const isAuthor = [v.createdBy, v.submittedBy].includes(me.id);
  const citeIndex = (label: string) =>
    v.provenance.citations.find((c) => c.label === label)?.index ?? null;
  const refresh = async () => {
    await invalidateAdmin(qc);
    await query.refetch();
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await flush();
      await fn();
      await refresh();
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link
        href={`/courses/${v.courseId}/topics/${v.topicId}`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {v.context.courseCode} ·{' '}
        {v.context.topicTitle}
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            {KIND_LABEL[v.kind]} · Version {v.versionNumber} <VersionStatusBadge v={v} />{' '}
            {v.frozen && <Badge>Locked</Badge>}
            {material?.publishedVersionId === v.id && (
              <Badge tone="success" dot>
                Live for students
              </Badge>
            )}
          </span>
        }
        title={v.context.topicTitle}
        actions={
          <>
            {editable && <SaveIndicator state={saveState} />}
            {editable && canSubmit && (
              <Button
                onClick={() => act(() => contentSubmit(v.id), 'Submitted for review')}
                loading={busy}
              >
                <Send className="size-4" aria-hidden /> Submit for review
              </Button>
            )}
            {v.reviewStatus === 'in_review' &&
              v.submittedBy === me.id &&
              v.reviews.length === 0 && (
                <Button
                  variant="secondary"
                  onClick={() => act(() => contentWithdraw(v.id), 'Withdrawn to draft')}
                  loading={busy}
                >
                  <Undo2 className="size-4" aria-hidden /> Withdraw
                </Button>
              )}
            {v.reviewStatus === 'in_review' && canReview && !isAuthor && (
              <Button onClick={() => setReviewing(true)}>Review</Button>
            )}
            {v.reviewStatus === 'approved' && v.body?.kind === 'notes' && canManageQuiz && (
              <Button variant="secondary" onClick={() => setGeneratingQuestions(true)}>
                Generate questions
              </Button>
            )}
            {v.body && (
              <Button variant="ghost" onClick={() => setPreviewing(true)}>
                Preview as student
              </Button>
            )}
            {v.reviewStatus === 'approved' &&
              canPublish &&
              material &&
              material.publishedVersionId !== v.id && (
                <Button
                  onClick={() =>
                    setPublishAction({
                      kind: 'publish',
                      materialId: v.materialId,
                      versionId: v.id,
                      label: `${v.context.courseCode} · ${v.context.topicTitle} · ${KIND_LABEL[v.kind]} v${v.versionNumber}`,
                      warnings: [],
                    })
                  }
                >
                  Publish
                </Button>
              )}
            {canEdit && v.frozen && v.body && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await contentFork(v.id);
                    await invalidateAdmin(qc);
                    router.push(`/content/versions/${r.data.id}`);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Edit as new draft
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3">
        {saveState === 'conflict' && (
          <Alert tone="danger">
            This draft was changed somewhere else.{' '}
            <button className="font-medium underline" onClick={() => window.location.reload()}>
              Reload
            </button>{' '}
            to continue with the latest version.
          </Alert>
        )}
        {v.generation?.provider === 'fake' && (
          <Alert tone="warning">
            <Sparkles className="mr-1 inline size-4" aria-hidden /> Development placeholder:
            produced without an AI model. Add OpenAI credits and switch AI_TEXT_PROVIDER to openai
            for real content.
          </Alert>
        )}
        {v.reviewStatus === 'in_review' && canReview && isAuthor && (
          <Alert tone="info">
            You created or submitted this version, so another reviewer must review it.
          </Alert>
        )}
        {v.provenance.insufficientSources && (
          <Alert tone="warning">
            The approved sources didn’t fully cover this topic
            {v.provenance.missingTopics.length ? `: ${v.provenance.missingTopics.join(', ')}` : ''}.
            Check the content carefully, or upload and approve more sources and regenerate.
          </Alert>
        )}
        {v.provenance.warnings.filter((w) => !w.startsWith('Development placeholder')).length >
          0 && (
          <Alert tone="info">
            <p className="mb-1 font-medium">Checks made during generation</p>
            <ul className="list-disc pl-5">
              {v.provenance.warnings
                .filter((w) => !w.startsWith('Development placeholder'))
                .map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
            </ul>
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          {!ready ? (
            v.generationStatus === 'failed' ? (
              <Alert tone="danger">Generation failed: {v.generation?.error}</Alert>
            ) : (
              <Card className="flex flex-col items-center px-6 py-16 text-center">
                <Loader2 className="mb-3 size-6 animate-spin text-primary" aria-hidden />
                <p className="text-sm font-medium">Generating from your approved sources…</p>
                <p className="mt-1 text-[13px] text-muted">This page updates automatically.</p>
              </Card>
            )
          ) : v.body?.kind === 'notes' ? (
            <RichEditor
              key={v.id}
              label={`${KIND_LABEL[v.kind]} for ${v.context.topicTitle}`}
              content={v.body.doc as JSONContent}
              editable={!!editable}
              onChange={(doc) =>
                queueSave({
                  kind: 'notes',
                  doc: doc as { type: 'doc'; content: unknown[] },
                  wordCount: 0,
                  readingMinutes: 0,
                })
              }
              onAiAction={
                canGenerate
                  ? async (action, text, context) =>
                      (await quizzesAiAction(v.id, { action, text, context })).data.suggestion
                  : undefined
              }
            />
          ) : v.body?.kind === 'quiz' && quiz ? (
            <QuizEditor
              versionId={v.id}
              value={quiz}
              editable={!!editable}
              onChange={(b) => {
                setQuiz(b);
                queueSave(b);
              }}
            />
          ) : revision ? (
            <RevisionEditor
              value={revision}
              editable={!!editable}
              citeIndex={citeIndex}
              onChange={(b) => {
                setRevision(b);
                queueSave(b);
              }}
            />
          ) : (
            <Alert tone="info">No content.</Alert>
          )}
          {v.body?.kind === 'notes' && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
              <span>
                {v.body.wordCount} words · {v.body.readingMinutes} min read
              </span>
              <span>
                <span className="mr-1 inline-block h-3 w-0.5 bg-success align-middle" aria-hidden />{' '}
                based on approved sources
              </span>
              <span>
                <span
                  className="mr-1 inline-block h-3 w-0.5 border-l-2 border-dashed border-violet align-middle"
                  aria-hidden
                />{' '}
                AI explanation (check carefully)
              </span>
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Sources cited"
              description={v.provenance.citations.length ? undefined : 'No sources were cited.'}
            />
            {v.provenance.citations.length > 0 && (
              <ol className="divide-y divide-border text-[13px]">
                {v.provenance.citations.map((c) => (
                  <li key={c.label} className="px-5 py-3">
                    <div className="font-medium">
                      <span className="mr-1 text-primary">[{c.index}]</span>
                      {c.sourceTitle}
                      {c.page ? `, p. ${c.page}` : ''}
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12.5px] text-muted">“{c.quote}”</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {material && (
            <Card>
              <CardHeader
                title="Versions"
                description={<DisplayStatusBadge status={material.displayStatus} />}
              />
              <ul className="p-2">
                {material.versions.map((mv) => (
                  <li key={mv.id}>
                    <Link
                      href={`/content/versions/${mv.id}`}
                      aria-current={mv.id === v.id ? 'page' : undefined}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[13px]',
                        mv.id === v.id
                          ? 'bg-primary-soft font-medium text-primary'
                          : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <FileClock className="size-3.5" aria-hidden /> v{mv.versionNumber}
                        {material.latestApprovedVersionId === mv.id ? ' ✓' : ''}
                      </span>
                      <VersionStatusBadge v={mv} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {v.reviews.length > 0 && (
            <Card>
              <CardHeader title="Reviews" />
              <ul className="divide-y divide-border text-[13px]">
                {v.reviews.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.reviewerName}</span>
                      <DisplayStatusBadge status={r.decision} />
                    </div>
                    {r.comment && (
                      <p className="mt-1 whitespace-pre-wrap text-muted">{r.comment}</p>
                    )}
                    <p className="mt-1 text-[12px] text-subtle">{fmtDate(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {v.generation && (
            <Card>
              <CardHeader title="Generation" />
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 px-5 py-4 text-[12.5px]">
                <dt className="text-muted">Provider</dt>
                <dd>
                  {v.generation.provider === 'fake'
                    ? 'Development placeholder'
                    : v.generation.provider}
                </dd>
                <dt className="text-muted">Model</dt>
                <dd className="break-all">{v.generation.model || '—'}</dd>
                <dt className="text-muted">Prompt</dt>
                <dd>{v.generation.promptVersion || '—'}</dd>
                <dt className="text-muted">Created</dt>
                <dd>{fmtDate(v.createdAt)}</dd>
              </dl>
            </Card>
          )}
        </aside>
      </div>
      <StudentPreviewDialog
        versionId={v.id}
        open={previewing}
        onClose={() => setPreviewing(false)}
      />
      <PublishActionDialog
        action={publishAction}
        onClose={() => {
          setPublishAction(null);
          void refresh();
        }}
      />
      {v.body?.kind === 'notes' && v.reviewStatus === 'approved' && (
        <GenerateQuestionsDialog
          versionId={v.id}
          open={generatingQuestions}
          onClose={() => setGeneratingQuestions(false)}
        />
      )}
      <ReviewDialog
        version={v}
        open={reviewing}
        onClose={() => setReviewing(false)}
        onDone={() => {
          void refresh();
          toast.success('Review recorded');
        }}
      />
    </>
  );
}
