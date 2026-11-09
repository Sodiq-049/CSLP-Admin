'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  publishingPublish,
  publishingRollback,
  publishingSchedule,
  publishingUnpublish,
  useContentMaterials,
} from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

export type PublishAction =
  | { kind: 'publish'; materialId: string; versionId: string; label: string; warnings: string[] }
  | { kind: 'schedule'; materialId: string; versionId: string; label: string }
  | { kind: 'unpublish'; materialId: string; label: string }
  | {
      kind: 'rollback';
      materialId: string;
      topicId: string;
      currentVersionId: string | null;
      label: string;
    };

const localNow = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function PublishActionDialog({
  action,
  onClose,
}: {
  action: PublishAction | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [when, setWhen] = useState(localNow(60));
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const materials = useContentMaterials(action?.kind === 'rollback' ? action.topicId : '', {
    query: { enabled: action?.kind === 'rollback' },
  });
  if (!action) return null;
  const rollbackOptions =
    action.kind === 'rollback'
      ? (materials.data?.data.find((m) => m.id === action.materialId)?.versions ?? []).filter(
          (v) => v.reviewStatus === 'approved' && v.id !== action.currentVersionId,
        )
      : [];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (action.kind === 'publish')
        await publishingPublish(action.materialId, { versionId: action.versionId });
      if (action.kind === 'schedule')
        await publishingSchedule(action.materialId, {
          versionId: action.versionId,
          publishAt: new Date(when).toISOString(),
        });
      if (action.kind === 'unpublish') await publishingUnpublish(action.materialId, { reason });
      if (action.kind === 'rollback')
        await publishingRollback(action.materialId, { toVersionId: target, reason });
      await invalidateAdmin(qc);
      toast.success(
        {
          publish: 'Published',
          schedule: 'Scheduled',
          unpublish: 'Unpublished',
          rollback: 'Rolled back',
        }[action.kind],
      );
      setReason('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    publish: 'Publish to students',
    schedule: 'Schedule publication',
    unpublish: 'Unpublish',
    rollback: 'Roll back to an earlier version',
  };
  const disabled =
    action.kind === 'unpublish'
      ? reason.trim().length < 3
      : action.kind === 'rollback'
        ? !target || reason.trim().length < 3
        : false;
  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[action.kind]}
      description={action.label}
      size="md"
      dismissible={!busy}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {action.kind === 'publish' && (
          <>
            <p className="text-sm text-muted">
              Students will see this version immediately
              {action.warnings.length ? ' once the items below are also published' : ''}.
            </p>
            {action.warnings.length > 0 && (
              <Alert tone="warning">
                <ul className="list-disc pl-5">
                  {action.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        )}
        {action.kind === 'schedule' && (
          <Field label="Publish at" hint="Your local time. At least 2 minutes from now.">
            {(p) => (
              <Input
                {...p}
                type="datetime-local"
                min={localNow(3)}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            )}
          </Field>
        )}
        {action.kind === 'rollback' && (
          <Field label="Version to show students">
            {(p) => (
              <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select an approved version</option>
                {rollbackOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.versionNumber}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {(action.kind === 'unpublish' || action.kind === 'rollback') && (
          <Field label="Reason" required hint="Recorded in the publishing history.">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={action.kind === 'unpublish' ? 'danger' : 'primary'}
            loading={busy}
            disabled={disabled}
            onClick={run}
          >
            {titles[action.kind].split(' ')[0]}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
