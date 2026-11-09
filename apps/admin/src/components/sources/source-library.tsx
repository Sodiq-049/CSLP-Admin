'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import {
  sourcesApprove,
  sourcesDownload,
  sourcesRemove,
  sourcesReprocess,
  sourcesRevoke,
  sourcesUpload,
  useSourcesChunks,
  useSourcesGet,
  useSourcesList,
  type SourceDocument,
} from '@cslp/api-client';
import {
  LICENCE_TYPES,
  SOURCE_CATEGORIES,
  type LicenceType,
  type SourceCategory,
} from '@cslp/shared-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Alert, EmptyState, Spinner } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtDate, invalidateAdmin } from '@/lib/query';

export const CATEGORY_LABEL: Record<SourceCategory, string> = {
  course_outline: 'Course outline',
  lecture_notes: 'Lecture notes',
  textbook_excerpt: 'Textbook excerpt',
  reference: 'Reference',
  technical_doc: 'Technical documentation',
  other: 'Other',
};
const LICENCE_LABEL: Record<LicenceType, string> = {
  institution_owned: 'Owned by the institution',
  licensed: 'Licensed to the institution',
  open: 'Openly licensed',
  fair_use_excerpt: 'Short excerpt (fair use)',
};
const BUSY = new Set(['uploaded', 'scanning', 'extracting', 'chunking', 'embedding']);
const fmtSize = (b: number) =>
  b > 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

export function ProcessingBadge({ doc }: { doc: SourceDocument }) {
  const s = doc.processing.status;
  if (BUSY.has(s))
    return (
      <Badge tone="info">
        <Loader2 className="size-3 animate-spin" aria-hidden />{' '}
        {s === 'uploaded' ? 'Queued' : s[0]!.toUpperCase() + s.slice(1)}
      </Badge>
    );
  if (s === 'failed') return <Badge tone="danger">Failed</Badge>;
  return (
    <Badge tone="success" dot>
      Ready
    </Badge>
  );
}

function UploadDialog({
  institutionId,
  courseId,
  open,
  onClose,
}: {
  institutionId: string;
  courseId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<SourceCategory>('lecture_notes');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [licenceType, setLicenceType] = useState<LicenceType>('institution_owned');
  const [licenceNotes, setLicenceNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await sourcesUpload(institutionId, {
        file,
        title: title.trim() || file.name.replace(/\.\w+$/, ''),
        category,
        licenceType,
        licenceConfirmed: 'true',
        ...(courseId ? { courseId } : {}),
        ...(authors.trim() ? { authors: authors.trim() } : {}),
        ...(year ? { year: Number(year) } : {}),
        ...(licenceNotes.trim() ? { licenceNotes: licenceNotes.trim() } : {}),
      });
      await invalidateAdmin(qc);
      toast.success('Uploaded. Processing has started.');
      setFile(null);
      setTitle('');
      setConfirmed(false);
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
      title="Upload source material"
      description="Approved sources ground AI-generated content and appear as citations. Only upload material the institution may use."
      size="lg"
      dismissible={!busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="File" required hint="PDF, Word (.docx) or plain text, up to 50 MB.">
          {(p) => (
            <Input
              {...p}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.\w+$/, ''));
              }}
              className="py-1.5"
            />
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" required>
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Type">
            {(p) => (
              <Select
                {...p}
                value={category}
                onChange={(e) => setCategory(e.target.value as SourceCategory)}
              >
                {SOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Authors" hint="Separate with commas">
            {(p) => <Input {...p} value={authors} onChange={(e) => setAuthors(e.target.value)} />}
          </Field>
          <Field label="Year">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1800}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            )}
          </Field>
          <Field label="Licence">
            {(p) => (
              <Select
                {...p}
                value={licenceType}
                onChange={(e) => setLicenceType(e.target.value as LicenceType)}
              >
                {LICENCE_TYPES.map((l) => (
                  <option key={l} value={l}>
                    {LICENCE_LABEL[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Licence notes" hint="e.g. licence number or permission reference">
            {(p) => (
              <Input
                {...p}
                value={licenceNotes}
                onChange={(e) => setLicenceNotes(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Checkbox
          label="I confirm the institution has the right to use this material for teaching."
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!file || !confirmed || title.trim().length < 2}
          >
            <FileUp className="size-4" aria-hidden /> Upload
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SourceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useSourcesGet(id, {
    query: {
      refetchInterval: (q) =>
        q.state.data && BUSY.has(q.state.data.data.processing.status) ? 2000 : false,
    },
  });
  const doc = query.data?.data;
  const [page, setPage] = useState(1);
  const chunks = useSourcesChunks(
    id,
    { page, pageSize: 10 },
    { query: { enabled: doc?.processing.status === 'ready' } },
  );
  const canApprove = useCan('source.approve_for_generation', doc?.institutionId);
  const canUpload = useCan('source.upload', doc?.institutionId);
  const canDelete = useCan('source.delete', doc?.institutionId);
  const [deleting, setDeleting] = useState(false);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await invalidateAdmin(qc);
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onClose={onClose} title={doc?.title ?? 'Source'} size="lg">
      {!doc ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <ProcessingBadge doc={doc} />
            <Badge>{CATEGORY_LABEL[doc.category]}</Badge>
            {doc.approvedForGeneration ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" aria-hidden /> Approved for AI generation
              </Badge>
            ) : (
              <Badge tone="warning">Not approved for AI generation</Badge>
            )}
            {doc.scanStatus === 'clean' && (
              <Badge tone="success">
                <ShieldCheck className="size-3" aria-hidden /> Virus scan clean
              </Badge>
            )}
            {doc.scanStatus === 'skipped' && <Badge>Virus scan not configured</Badge>}
          </div>
          {doc.processing.error && <Alert tone="danger">{doc.processing.error}</Alert>}
          {doc.processing.warnings.length > 0 && (
            <Alert tone="warning">
              <ul className="list-disc pl-5">
                {doc.processing.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">File</dt>
            <dd>
              {doc.file.name} · {fmtSize(doc.file.sizeBytes)}
              {doc.file.pageCount ? ` · ${doc.file.pageCount} pages` : ''}
            </dd>
            {doc.authors.length > 0 && (
              <>
                <dt className="text-muted">Authors</dt>
                <dd>
                  {doc.authors.join(', ')}
                  {doc.year ? ` (${doc.year})` : ''}
                </dd>
              </>
            )}
            <dt className="text-muted">Licence</dt>
            <dd>
              {LICENCE_LABEL[doc.licence.type]}
              {doc.licence.notes ? ` · ${doc.licence.notes}` : ''}
            </dd>
            <dt className="text-muted">Processed</dt>
            <dd>
              {doc.processing.chunkCount} passages{doc.processing.embedded ? ', searchable' : ''}
            </dd>
            <dt className="text-muted">Uploaded</dt>
            <dd>{fmtDate(doc.createdAt)}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  window.open((await sourcesDownload(id)).data.url, '_blank', 'noopener');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <Download className="size-3.5" aria-hidden /> Download
            </Button>
            {canApprove && doc.processing.status === 'ready' && !doc.approvedForGeneration && (
              <Button
                size="sm"
                onClick={() => act(() => sourcesApprove(id), 'Approved for AI generation')}
              >
                Approve for AI generation
              </Button>
            )}
            {canApprove && doc.approvedForGeneration && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => act(() => sourcesRevoke(id), 'Approval withdrawn')}
              >
                Withdraw approval
              </Button>
            )}
            {canUpload && ['failed', 'ready'].includes(doc.processing.status) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => act(() => sourcesReprocess(id), 'Processing restarted')}
              >
                <RefreshCw className="size-3.5" aria-hidden /> Reprocess
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-3.5" aria-hidden /> Delete
              </Button>
            )}
          </div>
          {doc.processing.status === 'ready' && (
            <section>
              <h3 className="mb-2 font-semibold">Extracted passages</h3>
              {chunks.isLoading ? (
                <Spinner />
              ) : (
                <ol className="flex flex-col gap-2">
                  {chunks.data?.data.map((c) => (
                    <li key={c.id} className="rounded-md border border-border p-3">
                      <div className="mb-1 flex flex-wrap gap-2 text-[12px] text-muted">
                        <span>#{c.ordinal + 1}</span>
                        {c.page && <span>page {c.page}</span>}
                        {c.headingPath.length > 0 && <span>{c.headingPath.join(' › ')}</span>}
                        <span>≈{c.tokenCount} tokens</span>
                      </div>
                      <p className="line-clamp-4 whitespace-pre-wrap">{c.text}</p>
                    </li>
                  ))}
                </ol>
              )}
              {chunks.data && (
                <Pagination
                  page={page}
                  pageSize={10}
                  total={chunks.data.meta.total ?? 0}
                  onPage={setPage}
                />
              )}
            </section>
          )}
          <ConfirmDialog
            open={deleting}
            onClose={() => setDeleting(false)}
            title="Delete this source?"
            body="The file and its passages are removed and it can no longer ground generated content."
            confirmLabel="Delete"
            onConfirm={async () => {
              await act(() => sourcesRemove(id), 'Source deleted');
              onClose();
            }}
          />
        </div>
      )}
    </Dialog>
  );
}

export function SourceLibrary({
  institutionId,
  courseId,
}: {
  institutionId: string;
  courseId?: string;
}) {
  const canUpload = useCan('source.upload', institutionId);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useSourcesList(
    {
      institutionId,
      page,
      pageSize: 25,
      ...(courseId ? { courseId } : {}),
      ...(q ? { q } : {}),
      ...(category ? { category: category as SourceCategory } : {}),
    },
    {
      query: {
        refetchInterval: (qq) =>
          qq.state.data?.data.some((d) => BUSY.has(d.processing.status)) ? 2500 : false,
      },
    },
  );

  const columns: Column<SourceDocument>[] = [
    {
      key: 'title',
      header: 'Source',
      cell: (d) => (
        <button onClick={() => setOpen(d.id)} className="group block text-left">
          <span className="font-medium text-fg group-hover:text-primary group-hover:underline">
            {d.title}
          </span>
          <span className="block text-[12.5px] text-muted">
            {d.file.name} · {fmtSize(d.file.sizeBytes)}
          </span>
        </button>
      ),
    },
    {
      key: 'category',
      header: 'Type',
      className: 'hidden md:table-cell',
      cell: (d) => CATEGORY_LABEL[d.category],
    },
    {
      key: 'status',
      header: 'Processing',
      className: 'w-32',
      cell: (d) => <ProcessingBadge doc={d} />,
    },
    {
      key: 'approved',
      header: 'AI use',
      className: 'hidden w-28 sm:table-cell',
      cell: (d) =>
        d.approvedForGeneration ? <Badge tone="success">Approved</Badge> : <Badge>Pending</Badge>,
    },
    {
      key: 'date',
      header: 'Uploaded',
      className: 'hidden lg:table-cell',
      cell: (d) => <span className="text-[13px] text-muted">{fmtDate(d.createdAt)}</span>,
    },
  ];

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search sources"
          />
          <Select
            aria-label="Type"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-52"
          >
            <option value="">All types</option>
            {SOURCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
          {canUpload && (
            <Button className="ml-auto" onClick={() => setUploading(true)}>
              <FileUp className="size-4" aria-hidden /> Upload
            </Button>
          )}
        </div>
        <DataTable
          caption="Source documents"
          columns={columns}
          rows={list.data?.data}
          rowKey={(d) => d.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title="No sources yet"
              body="Upload lecture notes, licensed textbook excerpts or references. Reviewers approve them before AI tools can use them."
            />
          }
        />
        {list.data && (
          <Pagination
            page={page}
            pageSize={25}
            total={list.data.meta.total ?? 0}
            onPage={setPage}
          />
        )}
      </Card>
      {canUpload && (
        <UploadDialog
          institutionId={institutionId}
          courseId={courseId}
          open={uploading}
          onClose={() => setUploading(false)}
        />
      )}
      {open && <SourceDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
