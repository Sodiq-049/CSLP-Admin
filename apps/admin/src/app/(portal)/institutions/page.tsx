'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useInstitutionsCreate, useInstitutionsList, type Institution } from '@cslp/api-client';
import { CreateInstitutionSchema } from '@cslp/validation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

type FormValues = z.input<typeof CreateInstitutionSchema>;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function CreateInstitutionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const create = useInstitutionsCreate();
  const form = useForm<FormValues>({
    resolver: zodResolver(CreateInstitutionSchema),
    defaultValues: { name: '', shortName: '', slug: '', city: '' },
  });
  const { register, handleSubmit, formState, setValue, getFieldState } = form;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await create.mutateAsync({ data: { ...values, city: values.city || undefined } });
      await invalidateAdmin(qc);
      toast.success(`${values.shortName} created`);
      form.reset();
      onClose();
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setError(errorMessage(err));
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New institution"
      description="Only the institution record is created. Its faculties, departments and programmes are added afterwards."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Full name" required error={formState.errors.name?.message}>
          {(p) => <Input {...p} placeholder="Yaba College of Technology" {...register('name')} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Short name" required error={formState.errors.shortName?.message}>
            {(p) => (
              <Input
                {...p}
                placeholder="YABATECH"
                {...register('shortName', {
                  onChange: (e) =>
                    !getFieldState('slug').isDirty && setValue('slug', slugify(e.target.value)),
                })}
              />
            )}
          </Field>
          <Field
            label="URL slug"
            required
            hint="Used in student website URLs."
            error={formState.errors.slug?.message}
          >
            {(p) => <Input {...p} placeholder="yabatech" {...register('slug')} />}
          </Field>
        </div>
        <Field label="City" error={formState.errors.city?.message}>
          {(p) => <Input {...p} placeholder="Lagos" {...register('city')} />}
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            Create institution
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function InstitutionsPage() {
  const canCreate = useCan('institution.create');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useInstitutionsList({
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(includeArchived ? { includeArchived: 'true' } : {}),
  });

  const columns: Column<Institution>[] = [
    {
      key: 'name',
      header: 'Institution',
      cell: (i) => (
        <Link
          href={`/institutions/${i.id}`}
          className="font-medium text-fg hover:text-primary hover:underline"
        >
          {i.name}
          <span className="ml-2 text-[12.5px] font-normal text-muted">{i.shortName}</span>
        </Link>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      cell: (i) => <code className="text-[12.5px] text-muted">{i.slug}</code>,
      className: 'hidden md:table-cell',
    },
    {
      key: 'city',
      header: 'Location',
      cell: (i) => [i.city, i.country].filter(Boolean).join(', '),
      className: 'hidden sm:table-cell',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (i) =>
        i.archivedAt ? (
          <Badge>Archived</Badge>
        ) : i.status === 'active' ? (
          <Badge tone="success" dot>
            Active
          </Badge>
        ) : (
          <Badge tone="warning">Suspended</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Institutions"
        description="Institutions you can administer. Every course, document and student belongs to exactly one institution."
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New institution
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search institutions"
          />
          <Checkbox
            label="Show archived"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
        </div>
        <DataTable
          caption="Institutions"
          columns={columns}
          rows={list.data?.data}
          rowKey={(i) => i.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title={q ? 'No matching institutions' : 'No institutions yet'}
              body={canCreate && !q ? 'Create the first institution to get started.' : undefined}
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
      {canCreate && <CreateInstitutionDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}
