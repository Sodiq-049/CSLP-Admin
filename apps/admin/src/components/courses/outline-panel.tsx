'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FileUp, Loader2, Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  outlinesApprove,
  outlinesCreate,
  outlinesDocument,
  outlinesSync,
  outlinesUpdate,
  outlinesUpload,
  useOutlinesGet,
  useOutlinesList,
  type Course,
  type CourseOutline,
  type TopicSyncPlan,
} from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { Alert, EmptyState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtDate, invalidateAdmin } from '@/lib/query';

type OutlineNode = CourseOutline['structure'][number];
type Leaf = OutlineNode['children'][number];
const newKey = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROCESSING = new Set(['pending', 'extracting']);

const STATUS_BADGE: Record<CourseOutline['status'], React.ReactNode> = {
  draft: <Badge tone="warning">Draft</Badge>,
  approved: (
    <Badge tone="success" dot>
      Approved
    </Badge>
  ),
  superseded: <Badge>Superseded</Badge>,
};

/* ───────────── create a new version ───────────── */

function NewVersionDialog({
  course,
  open,
  onClose,
  onCreated,
}: {
  course: Course;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'upload' | 'paste' | 'manual'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [licence, setLicence] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'upload'
          ? await outlinesUpload(course.id, { file: file!, licenceConfirmed: 'true' })
          : mode === 'paste'
            ? await outlinesCreate(course.id, { origin: 'paste', text })
            : await outlinesCreate(course.id, {
                origin: 'manual',
                structure: [
                  {
                    key: newKey(),
                    title: 'First topic',
                    sourceQuote: null,
                    confidence: null,
                    children: [],
                  },
                ],
              });
      await invalidateAdmin(qc);
      onCreated(r.data.id);
      setFile(null);
      setText('');
      setLicence(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'upload', label: 'Upload a file' },
    { id: 'paste', label: 'Paste text' },
    { id: 'manual', label: 'Start blank' },
  ] as const;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New outline version"
      description="Every version is kept. Nothing changes the course until a version is approved."
      size="lg"
      dismissible={!busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div
          role="radiogroup"
          aria-label="How to add the outline"
          className="grid grid-cols-3 gap-2"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={mode === t.id}
              onClick={() => setMode(t.id)}
              className={cn(
                'rounded-md border px-3 py-2 text-[13px]',
                mode === t.id
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border hover:bg-surface-2',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {mode === 'upload' && (
          <>
            <Field
              label="Outline file"
              required
              hint="PDF, Word (.docx) or plain text, up to 50 MB. The original file is kept with the course."
            >
              {(p) => (
                <Input
                  {...p}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="py-1.5"
                />
              )}
            </Field>
            <Checkbox
              label="I confirm the institution owns this outline or has permission to use it."
              checked={licence}
              onChange={(e) => setLicence(e.target.checked)}
            />
          </>
        )}
        {mode === 'paste' && (
          <Field
            label="Outline text"
            required
            hint="Paste the official outline. Topics are detected for you to review."
          >
            {(p) => (
              <Textarea
                {...p}
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="font-mono text-[12.5px]"
              />
            )}
          </Field>
        )}
        {mode === 'manual' && (
          <p className="text-sm text-muted">
            Start with an empty outline and type the topics in yourself.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={
              mode === 'upload'
                ? !file || !licence
                : mode === 'paste'
                  ? text.trim().length < 20
                  : false
            }
          >
            {mode === 'upload' ? (
              <>
                <FileUp className="size-4" aria-hidden /> Upload and analyse
              </>
            ) : mode === 'paste' ? (
              'Analyse text'
            ) : (
              'Create outline'
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ───────────── structure editor ───────────── */

function StructureEditor({
  value,
  onChange,
  disabled,
}: {
  value: OutlineNode[];
  onChange: (v: OutlineNode[]) => void;
  disabled: boolean;
}) {
  const update = (i: number, patch: Partial<OutlineNode>) =>
    onChange(value.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const move = <T,>(list: T[], i: number, d: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    return next;
  };
  if (!value.length)
    return <p className="px-1 py-3 text-sm text-muted">No topics in this version yet.</p>;
  return (
    <ol className="flex flex-col gap-3" aria-label="Outline topics">
      {value.map((n, i) => (
        <li key={n.key} className="rounded-md border border-border bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className="w-6 text-right text-[12px] text-subtle tabular-nums">{i + 1}.</span>
            <Input
              aria-label={`Topic ${i + 1} title`}
              value={n.title}
              disabled={disabled}
              onChange={(e) => update(i, { title: e.target.value })}
              className="h-8 flex-1 text-[13px] font-medium"
            />
            {!disabled && (
              <div className="flex">
                <Small
                  label="Move up"
                  icon={ArrowUp}
                  disabled={i === 0}
                  onClick={() => onChange(move(value, i, -1))}
                />
                <Small
                  label="Move down"
                  icon={ArrowDown}
                  disabled={i === value.length - 1}
                  onClick={() => onChange(move(value, i, 1))}
                />
                <Small
                  label={`Add subtopic to topic ${i + 1}`}
                  icon={Plus}
                  onClick={() =>
                    update(i, {
                      children: [
                        ...n.children,
                        { key: newKey(), title: '', sourceQuote: null, confidence: null },
                      ],
                    })
                  }
                />
                <Small
                  label={`Remove topic ${i + 1}`}
                  icon={Trash2}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                />
              </div>
            )}
          </div>
          {n.sourceQuote && (
            <p className="mt-1 ml-8 truncate text-[12px] text-subtle" title={n.sourceQuote}>
              Source: “{n.sourceQuote}”
            </p>
          )}
          {n.children.length > 0 && (
            <ol className="mt-2 ml-8 flex flex-col gap-1.5 border-l border-border pl-3">
              {n.children.map((c, ci) => (
                <li key={c.key} className="flex items-center gap-2">
                  <span className="w-8 text-right text-[12px] text-subtle tabular-nums">
                    {i + 1}.{ci + 1}
                  </span>
                  <Input
                    aria-label={`Subtopic ${i + 1}.${ci + 1} title`}
                    value={c.title}
                    disabled={disabled}
                    onChange={(e) =>
                      update(i, {
                        children: n.children.map((x, k) =>
                          k === ci ? { ...x, title: e.target.value } : x,
                        ),
                      })
                    }
                    className="h-8 flex-1 text-[13px]"
                  />
                  {!disabled && (
                    <div className="flex">
                      <Small
                        label="Move up"
                        icon={ArrowUp}
                        disabled={ci === 0}
                        onClick={() => update(i, { children: move(n.children, ci, -1) })}
                      />
                      <Small
                        label="Move down"
                        icon={ArrowDown}
                        disabled={ci === n.children.length - 1}
                        onClick={() => update(i, { children: move(n.children, ci, 1) })}
                      />
                      <Small
                        label={`Remove subtopic ${i + 1}.${ci + 1}`}
                        icon={Trash2}
                        onClick={() =>
                          update(i, { children: n.children.filter((_, k) => k !== ci) })
                        }
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  );
}

function Small({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/* ───────────── metadata comparison ───────────── */

function MetadataCompare({ outline, course }: { outline: CourseOutline; course: Course }) {
  const m = outline.extraction.detectedMetadata;
  if (!m) return null;
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rows = [
    {
      label: 'Course code',
      found: m.courseCode,
      stored: course.code,
      same: norm(m.courseCode) === norm(course.code),
    },
    {
      label: 'Course title',
      found: m.courseTitle,
      stored: course.title,
      same: norm(m.courseTitle) === norm(course.title),
    },
    {
      label: 'Credit units',
      found: m.creditUnits?.toString() ?? null,
      stored: String(course.creditUnits),
      same: m.creditUnits === course.creditUnits,
    },
  ].filter((r) => r.found);
  return (
    <Card>
      <CardHeader
        title="Found in the document"
        description="Shown for checking only. Course records are never changed automatically."
      />
      {rows.length === 0 && m.objectives.length === 0 && (
        <p className="px-5 py-3 text-[13px] text-muted">
          No course code, title, credit units or objectives were found in the text.
        </p>
      )}
      <dl className="divide-y divide-border text-[13px]">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 px-5 py-2.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium">{r.found}</dd>
            <dd className="col-start-2">
              {r.same ? (
                <span className="text-success">Matches the course record</span>
              ) : (
                <Badge tone="warning">Course record says “{r.stored}”</Badge>
              )}
            </dd>
          </div>
        ))}
        {m.objectives.length > 0 && (
          <div className="px-5 py-2.5">
            <dt className="mb-1 text-muted">Objectives found ({m.objectives.length})</dt>
            <dd>
              <ol className="list-decimal space-y-0.5 pl-5">
                {m.objectives.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ol>
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

/* ───────────── selected outline ───────────── */

function OutlineReview({
  outlineId,
  course,
  readOnly,
}: {
  outlineId: string;
  course: Course;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan('outline.upload', course.institutionId) && !readOnly;
  const canApprove = useCan('outline.approve', course.institutionId) && !readOnly;
  const canSync = useCan('topic.manage', course.institutionId) && !readOnly;
  const query = useOutlinesGet(outlineId, {
    query: {
      refetchInterval: (q) =>
        q.state.data && PROCESSING.has(q.state.data.data.extraction.status) ? 2000 : false,
    },
  });
  const outline = query.data?.data;
  const [structure, setStructure] = useState<OutlineNode[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [plan, setPlan] = useState<TopicSyncPlan | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (outline && !dirty) setStructure(outline.structure);
  }, [outline, dirty]);

  const suggestions = useMemo(() => {
    if (!outline) return [];
    const titles = new Set(
      structure
        .flatMap((n) => [n.title, ...n.children.map((c) => c.title)])
        .map((t) => t.toLowerCase()),
    );
    return outline.extraction.suggestedStructure.filter((n) => !titles.has(n.title.toLowerCase()));
  }, [outline, structure]);

  if (query.isLoading || !outline) return <Spinner />;
  const editable = canEdit && outline.status === 'draft';
  const processing = PROCESSING.has(outline.extraction.status);
  const change = (v: OutlineNode[]) => {
    setStructure(v);
    setDirty(true);
  };
  const invalid = structure.some((n) => !n.title.trim() || n.children.some((c) => !c.title.trim()));

  const save = async () => {
    setSaving(true);
    try {
      await outlinesUpdate(outline.id, {
        structure: structure.map((n) => ({
          ...n,
          title: n.title.trim(),
          children: n.children.map((c) => ({ ...c, title: c.title.trim() })),
        })),
      });
      setDirty(false);
      await invalidateAdmin(qc);
      toast.success('Outline saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    try {
      const r = await outlinesDocument(outline.id);
      window.open(r.data.url, '_blank', 'noopener');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
          <h3 className="text-[15px] font-semibold">Version {outline.version}</h3>
          {STATUS_BADGE[outline.status]}
          {course.activeOutlineId === outline.id && (
            <Badge tone="primary">Active for this course</Badge>
          )}
          <span className="text-[12.5px] text-muted">
            {outline.origin === 'upload'
              ? 'Uploaded file'
              : outline.origin === 'paste'
                ? 'Pasted text'
                : 'Entered manually'}{' '}
            · {fmtDate(outline.createdAt)}
          </span>
          {outline.extraction.method && (
            <Badge tone={outline.extraction.method === 'ai' ? 'violet' : 'info'}>
              <Wand2 className="size-3" aria-hidden />{' '}
              {outline.extraction.method === 'ai'
                ? 'AI-assisted detection'
                : 'Detected from document layout'}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {outline.sourceDocumentId && (
              <Button variant="secondary" size="sm" onClick={download}>
                <Download className="size-3.5" aria-hidden /> Original file
              </Button>
            )}
            {editable && (
              <Button
                variant="secondary"
                size="sm"
                onClick={save}
                loading={saving}
                disabled={!dirty || invalid}
              >
                Save changes
              </Button>
            )}
            {canApprove && outline.status === 'draft' && (
              <Button
                size="sm"
                onClick={() => setApproving(true)}
                disabled={dirty || processing || !structure.length}
              >
                Approve outline
              </Button>
            )}
            {canSync && outline.status === 'approved' && (
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    setPlan((await outlinesSync(outline.id)).data);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Sync topics…
              </Button>
            )}
          </div>
        </div>
        {processing && (
          <div
            className="flex items-center gap-2 border-t border-border bg-info-soft px-5 py-3 text-[13px]"
            role="status"
          >
            <Loader2 className="size-4 animate-spin text-info" aria-hidden /> Reading the document
            and detecting topics… this usually takes a few seconds.
          </div>
        )}
        {outline.extraction.status === 'failed' && (
          <div className="border-t border-border px-5 py-3">
            <Alert tone="danger">
              Topic detection failed: {outline.extraction.error}. You can still enter the topics
              manually.
            </Alert>
          </div>
        )}
        {dirty && (
          <div className="border-t border-border px-5 py-2 text-[12.5px] text-warning">
            Unsaved changes. Save before approving.
          </div>
        )}
      </Card>

      {outline.extraction.warnings.length > 0 && (
        <Alert tone="warning">
          <p className="mb-1 font-medium">Please check</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {outline.extraction.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader
            title="Topics in this outline"
            description={
              editable
                ? 'Correct titles, order and nesting. Only what you approve here is used.'
                : 'Read-only'
            }
            actions={
              editable && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    change([
                      ...structure,
                      {
                        key: newKey(),
                        title: '',
                        sourceQuote: null,
                        confidence: null,
                        children: [],
                      },
                    ])
                  }
                >
                  <Plus className="size-3.5" aria-hidden /> Add topic
                </Button>
              )
            }
          />
          <div className="px-4 py-4">
            <StructureEditor value={structure} onChange={change} disabled={!editable} />
          </div>
          {invalid && (
            <p className="px-5 pb-3 text-[12.5px] text-danger">
              Every topic and subtopic needs a title.
            </p>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          {editable && suggestions.length > 0 && (
            <Card>
              <CardHeader
                title="Other suggestions"
                description="Detected but not included, usually because confidence was low."
              />
              <ul className="divide-y divide-border">
                {suggestions.map((s) => (
                  <li key={s.key} className="flex items-start gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-medium">
                        {s.title}{' '}
                        <Badge tone={s.confidence === 'low' ? 'warning' : 'neutral'}>
                          {s.confidence ?? 'unknown'}
                        </Badge>
                      </div>
                      {s.sourceQuote && (
                        <p className="truncate text-[12px] text-subtle">“{s.sourceQuote}”</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        change([
                          ...structure,
                          {
                            ...s,
                            key: newKey(),
                            children: s.children.map((c: Leaf) => ({ ...c, key: newKey() })),
                          },
                        ])
                      }
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <MetadataCompare outline={outline} course={course} />
          {outline.rawText && (
            <Card>
              <details>
                <summary className="cursor-pointer px-5 py-4 text-[15px] font-semibold">
                  Extracted text
                </summary>
                <pre className="max-h-96 overflow-auto border-t border-border px-5 py-4 font-mono text-[12px] whitespace-pre-wrap text-muted">
                  {outline.rawText}
                </pre>
              </details>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={approving}
        onClose={() => setApproving(false)}
        title={`Approve version ${outline.version}?`}
        body={
          <>
            This becomes the course’s official outline
            {course.activeOutlineId ? ' and replaces the currently active version' : ''}. Approved
            versions can’t be edited; create a new version to make changes.
          </>
        }
        confirmLabel="Approve outline"
        tone="primary"
        onConfirm={async () => {
          try {
            await outlinesApprove(outline.id);
            await invalidateAdmin(qc);
            toast.success('Outline approved');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />

      <Dialog
        open={!!plan}
        onClose={() => !applying && setPlan(null)}
        title="Sync topics from the outline"
        description="Missing topics are created in outline order. Existing topics are never renamed or deleted."
        size="lg"
        footer={
          plan && (
            <>
              <Button variant="secondary" onClick={() => setPlan(null)} disabled={applying}>
                Close
              </Button>
              <Button
                loading={applying}
                disabled={!plan.create.length}
                onClick={async () => {
                  setApplying(true);
                  try {
                    await outlinesSync(outline.id, { apply: 'true' });
                    await invalidateAdmin(qc);
                    toast.success(
                      `${plan.create.length} topic${plan.create.length === 1 ? '' : 's'} created`,
                    );
                    setPlan(null);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setApplying(false);
                  }
                }}
              >
                {plan.create.length
                  ? `Create ${plan.create.length} topic${plan.create.length === 1 ? '' : 's'}`
                  : 'Nothing to create'}
              </Button>
            </>
          )
        }
      >
        {plan && (
          <div className="flex flex-col gap-4 text-[13px]">
            <SyncList
              title="Will be created"
              tone="success"
              items={plan.create.map((c) =>
                c.parentTitle ? `${c.parentTitle} › ${c.title}` : c.title,
              )}
              empty="Every outline topic already exists."
            />
            <SyncList
              title="Already in the course"
              tone="neutral"
              items={plan.matched.map((m) => m.title)}
              empty="None."
            />
            <SyncList
              title="In the course but not in this outline (kept)"
              tone="warning"
              items={plan.notInOutline.map((t) => t.title)}
              empty="None."
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}

function SyncList({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'neutral' | 'warning';
  empty: string;
}) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-2 font-medium">
        {title} <Badge tone={tone}>{items.length}</Badge>
      </h4>
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-muted">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-subtle">{empty}</p>
      )}
    </section>
  );
}

/* ───────────── panel ───────────── */

export function OutlinePanel({ course, readOnly }: { course: Course; readOnly: boolean }) {
  const canUpload = useCan('outline.upload', course.institutionId) && !readOnly;
  const list = useOutlinesList(course.id, {
    query: {
      refetchInterval: (q) =>
        q.state.data?.data.some((o) => PROCESSING.has(o.extraction.status)) ? 3000 : false,
    },
  });
  const outlines = list.data?.data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current =
    selected ??
    outlines.find((o) => o.status === 'draft')?.id ??
    course.activeOutlineId ??
    outlines[0]?.id ??
    null;

  if (list.isLoading) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[14rem_1fr]">
      <Card className="self-start">
        <CardHeader
          title="Versions"
          actions={
            canUpload && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" aria-hidden /> New
              </Button>
            )
          }
        />
        {outlines.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted">No outline yet.</p>
        ) : (
          <ul className="p-2">
            {outlines.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => setSelected(o.id)}
                  aria-current={current === o.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-[13px]',
                    current === o.id
                      ? 'bg-primary-soft font-medium text-primary'
                      : 'hover:bg-surface-2',
                  )}
                >
                  <span>Version {o.version}</span>
                  {PROCESSING.has(o.extraction.status) ? (
                    <Loader2 className="size-3.5 animate-spin" aria-label="Processing" />
                  ) : (
                    STATUS_BADGE[o.status]
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {current ? (
        <OutlineReview key={current} outlineId={current} course={course} readOnly={readOnly} />
      ) : (
        <Card>
          <EmptyState
            title="No course outline yet"
            body="Upload the official outline (PDF, Word or text), paste it, or type it in. Topics are detected for you to review before anything is saved to the course."
            action={
              canUpload ? (
                <Button onClick={() => setCreating(true)}>
                  <FileUp className="size-4" aria-hidden /> Add outline
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
      {canUpload && (
        <NewVersionDialog
          course={course}
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={setSelected}
        />
      )}
    </div>
  );
}
