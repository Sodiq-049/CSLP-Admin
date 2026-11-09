'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Archive, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Alert, EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

export interface ListParams {
  page: number;
  pageSize: number;
  q?: string;
  includeArchived?: 'true';
}
interface Row {
  id: string;
  archivedAt?: string | null;
}
type Paged<T> = { data: T[]; meta: { total?: number } };

export interface EntityManagerProps<T extends Row> {
  singular: string;
  /** Hook-shaped function returning the list query for the given params. */
  useRows: (params: ListParams) => UseQueryResult<Paged<T> | undefined, unknown>;
  columns: Column<T>[];
  canManage: boolean;
  archivable?: boolean;
  createSchema: z.ZodType<FieldValues, FieldValues>;
  updateSchema: z.ZodType<FieldValues, FieldValues>;
  createDefaults: FieldValues;
  toFormValues: (row: T) => FieldValues;
  renderForm: (form: UseFormReturn<FieldValues>, mode: 'create' | 'edit') => React.ReactNode;
  onCreate: (values: FieldValues) => Promise<unknown>;
  onUpdate: (row: T, values: FieldValues) => Promise<unknown>;
  onArchive?: (row: T) => Promise<unknown>;
  toolbar?: React.ReactNode;
  emptyHint?: string;
  /** Disable "New" with an explanation (e.g. a parent entity must exist first). */
  createBlockedReason?: string;
  rowLabel: (row: T) => string;
}

function EntityForm<T extends Row>({
  props,
  mode,
  row,
  onClose,
}: {
  props: EntityManagerProps<T>;
  mode: 'create' | 'edit';
  row?: T;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const schema = mode === 'create' ? props.createSchema : props.updateSchema;
  const form = useForm<FieldValues>({
    resolver: zodResolver(schema as never),
    defaultValues: mode === 'edit' && row ? props.toFormValues(row) : props.createDefaults,
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (mode === 'create') await props.onCreate(values);
      else await props.onUpdate(row!, values);
      await invalidateAdmin(qc);
      toast.success(mode === 'create' ? `${props.singular} created` : `${props.singular} saved`);
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setError(errorMessage(err));
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {props.renderForm(form, mode)}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {mode === 'create' ? `Create ${props.singular.toLowerCase()}` : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

export function EntityManager<T extends Row>(props: EntityManagerProps<T>) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; row: T } | null>(null);
  const [archiving, setArchiving] = useState<T | null>(null);

  const params: ListParams = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(includeArchived ? { includeArchived: 'true' } : {}),
  };
  const list = props.useRows(params);

  const columns: Column<T>[] = [
    ...props.columns,
    {
      key: '_status',
      header: 'Status',
      cell: (r) =>
        r.archivedAt ? (
          <Badge>Archived</Badge>
        ) : (
          <Badge tone="success" dot>
            Active
          </Badge>
        ),
      className: 'w-28',
    },
    ...(props.canManage
      ? [
          {
            key: '_actions',
            header: 'Actions',
            className: 'w-28 text-right',
            cell: (r: T) =>
              r.archivedAt ? null : (
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ mode: 'edit', row: r })}
                    aria-label={`Edit ${props.rowLabel(r)}`}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  {props.archivable !== false && props.onArchive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchiving(r)}
                      aria-label={`Archive ${props.rowLabel(r)}`}
                    >
                      <Archive className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              ),
          } satisfies Column<T>,
        ]
      : []),
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
            placeholder={`Search ${props.singular.toLowerCase()}s`}
          />
          {props.toolbar}
          <div className="ml-auto flex items-center gap-3">
            {props.archivable !== false && (
              <Checkbox
                label="Show archived"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
            )}
            {props.canManage && (
              <Button
                onClick={() => setDialog({ mode: 'create' })}
                disabled={!!props.createBlockedReason}
                title={props.createBlockedReason}
              >
                <Plus className="size-4" aria-hidden /> New {props.singular.toLowerCase()}
              </Button>
            )}
          </div>
        </div>
        {props.createBlockedReason && props.canManage && (
          <div className="border-b border-border px-4 py-2.5">
            <Alert tone="info">{props.createBlockedReason}</Alert>
          </div>
        )}
        <DataTable
          caption={`${props.singular}s`}
          columns={columns}
          rows={list.data?.data}
          rowKey={(r) => r.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          rowClassName={(r) => (r.archivedAt ? 'opacity-60' : undefined)}
          empty={
            <EmptyState
              title={
                q
                  ? `No matching ${props.singular.toLowerCase()}s`
                  : `No ${props.singular.toLowerCase()}s yet`
              }
              body={!q ? props.emptyHint : undefined}
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

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'edit'
            ? `Edit ${props.singular.toLowerCase()}`
            : `New ${props.singular.toLowerCase()}`
        }
      >
        {dialog && (
          <EntityForm
            props={props}
            mode={dialog.mode}
            row={dialog.mode === 'edit' ? dialog.row : undefined}
            onClose={() => setDialog(null)}
          />
        )}
      </Dialog>

      {archiving && props.onArchive && (
        <ConfirmDialog
          open
          onClose={() => setArchiving(null)}
          title={`Archive ${props.rowLabel(archiving)}?`}
          body="Archived items are hidden from pickers and lists but kept for history. Nothing is deleted."
          confirmLabel="Archive"
          onConfirm={async () => {
            try {
              await props.onArchive!(archiving);
              await invalidateAdmin(qc);
              toast.success(`${props.singular} archived`);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      )}
    </>
  );
}
