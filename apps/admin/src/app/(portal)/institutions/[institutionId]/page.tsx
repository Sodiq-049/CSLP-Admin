'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  useInstitutionsArchive,
  useInstitutionsGet,
  useInstitutionsUpdate,
} from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { useInstitution } from '@/lib/institution';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { fmtDate, invalidateAdmin } from '@/lib/query';

const EditSchema = z.object({
  name: z.string().trim().min(2).max(200),
  shortName: z.string().trim().min(2).max(30),
  city: z.string().trim().max(100),
  timezone: z.string().trim().min(1),
  aiMonthlyBudgetUsd: z.coerce.number().min(0),
  videoMonthlyBudgetUsd: z.coerce.number().min(0),
  studentAiChatEnabled: z.boolean(),
});
type EditValues = z.input<typeof EditSchema>;

export default function InstitutionDetailPage() {
  const { institutionId } = useParams<{ institutionId: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { setCurrentId } = useInstitution();
  const canUpdate = useCan('institution.update', institutionId);
  const canArchive = useCan('institution.archive', institutionId);
  const query = useInstitutionsGet(institutionId);
  const update = useInstitutionsUpdate();
  const archive = useInstitutionsArchive();
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const inst = query.data?.data;

  const form = useForm<EditValues, unknown, z.output<typeof EditSchema>>({
    resolver: zodResolver(EditSchema),
  });
  useEffect(() => {
    if (inst)
      form.reset({
        name: inst.name,
        shortName: inst.shortName,
        city: inst.city ?? '',
        timezone: inst.timezone,
        aiMonthlyBudgetUsd: inst.settings.aiMonthlyBudgetUsd,
        videoMonthlyBudgetUsd: inst.settings.videoMonthlyBudgetUsd,
        studentAiChatEnabled: inst.settings.studentAiChatEnabled,
      });
  }, [inst, form]);

  if (query.isLoading) return <Spinner />;
  if (query.error || !inst)
    return (
      <ErrorState
        message={errorMessage(query.error, 'Institution not found.')}
        onRetry={() => query.refetch()}
      />
    );

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await update.mutateAsync({
        institutionId,
        data: {
          name: v.name,
          shortName: v.shortName,
          city: v.city || undefined,
          timezone: v.timezone,
          settings: {
            aiMonthlyBudgetUsd: v.aiMonthlyBudgetUsd,
            videoMonthlyBudgetUsd: v.videoMonthlyBudgetUsd,
            studentAiChatEnabled: v.studentAiChatEnabled,
          },
        },
      });
      await invalidateAdmin(qc);
      toast.success('Institution saved');
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setError(errorMessage(err));
    }
  });

  const e = form.formState.errors;
  return (
    <>
      <Link
        href="/institutions"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Institutions
      </Link>
      <PageHeader
        title={inst.name}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {inst.shortName}{' '}
            {inst.archivedAt ? (
              <Badge>Archived</Badge>
            ) : (
              <Badge tone="success" dot>
                Active
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            <Link href="/structure/faculties" onClick={() => setCurrentId(inst.id)}>
              <Button variant="secondary">Manage academic structure</Button>
            </Link>
            {canArchive && !inst.archivedAt && (
              <Button variant="danger" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <form onSubmit={onSubmit} className="flex flex-col gap-4 px-5 py-5" noValidate>
            {error && <Alert tone="danger">{error}</Alert>}
            <fieldset disabled={!canUpdate || !!inst.archivedAt} className="flex flex-col gap-4">
              <Field label="Full name" required error={e.name?.message}>
                {(p) => <Input {...p} {...form.register('name')} />}
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Short name" required error={e.shortName?.message}>
                  {(p) => <Input {...p} {...form.register('shortName')} />}
                </Field>
                <Field label="City" error={e.city?.message}>
                  {(p) => <Input {...p} {...form.register('city')} />}
                </Field>
              </div>
              <Field label="Timezone" required error={e.timezone?.message}>
                {(p) => <Input {...p} {...form.register('timezone')} />}
              </Field>
              <h3 className="pt-2 text-[13px] font-semibold text-fg">AI budgets & features</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Monthly AI text budget (USD)"
                  hint="0 = no limit. Needs AI_PRICES_JSON to be enforced."
                  error={e.aiMonthlyBudgetUsd?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      step="1"
                      {...form.register('aiMonthlyBudgetUsd')}
                    />
                  )}
                </Field>
                <Field label="Monthly video budget (USD)" error={e.videoMonthlyBudgetUsd?.message}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      min={0}
                      step="1"
                      {...form.register('videoMonthlyBudgetUsd')}
                    />
                  )}
                </Field>
              </div>
              <Checkbox
                label="Enable the student AI tutor"
                {...form.register('studentAiChatEnabled')}
              />
            </fieldset>
            {canUpdate && !inst.archivedAt && (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={form.formState.isSubmitting}
                  disabled={!form.formState.isDirty}
                >
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </Card>
        <Card>
          <CardHeader title="Record" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-5 py-4 text-[13px]">
            <dt className="text-muted">Slug</dt>
            <dd>
              <code>{inst.slug}</code>
            </dd>
            <dt className="text-muted">Country</dt>
            <dd>{inst.country}</dd>
            <dt className="text-muted">Created</dt>
            <dd>{fmtDate(inst.createdAt)}</dd>
            <dt className="text-muted">Updated</dt>
            <dd>{fmtDate(inst.updatedAt)}</dd>
            {inst.archivedAt && (
              <>
                <dt className="text-muted">Archived</dt>
                <dd>{fmtDate(inst.archivedAt)}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
      <ConfirmDialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${inst.shortName}?`}
        body="The institution is suspended and hidden from lists. Its data is kept and nothing is deleted."
        confirmLabel="Archive institution"
        onConfirm={async () => {
          try {
            await archive.mutateAsync({ institutionId });
            await invalidateAdmin(qc);
            toast.success('Institution archived');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
