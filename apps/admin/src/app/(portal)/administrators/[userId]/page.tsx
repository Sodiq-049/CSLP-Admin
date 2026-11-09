'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  adminUsersAssignRole,
  adminUsersReactivate,
  adminUsersRevokeRole,
  adminUsersSuspend,
  useAdminUsersGet,
  type RoleAssignment,
} from '@cslp/api-client';
import { ROLE_LABELS, type Role } from '@cslp/shared-types';
import {
  grantableInstitutions,
  grantableRoles,
  roleOptions,
  ROLE_TONE,
} from '@/components/role-options';
import { useRecentAuth } from '@/components/shell/reauth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useInstitution } from '@/lib/institution';
import { can } from '@/lib/permissions';
import { fmtDate, invalidateAdmin } from '@/lib/query';
import { STATUS_BADGE } from '../page';

export default function AdministratorDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const me = useMe();
  const { institutions } = useInstitution();
  const qc = useQueryClient();
  const toast = useToast();
  const withRecentAuth = useRecentAuth();
  const query = useAdminUsersGet(userId);
  const canSuspend = useCan('admin_user.suspend');
  const [role, setRole] = useState<Role | ''>('');
  const [institutionId, setInstitutionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);

  const user = query.data?.data;
  if (query.isLoading) return <Spinner />;
  if (query.error || !user)
    return (
      <ErrorState
        message={errorMessage(query.error, 'Administrator not found.')}
        onRetry={() => query.refetch()}
      />
    );

  const isSelf = user.id === me.id;
  const roles = grantableRoles(me);
  const instOptions = grantableInstitutions(me, institutions, role || undefined);
  const canManageAssignment = (a: RoleAssignment) =>
    a.role === 'super_admin' || a.role === 'institution_admin'
      ? can(me, 'role.assign.any')
      : can(me, 'role.assign.any') || can(me, 'role.assign.institution_staff', a.institutionId);

  const refresh = () => invalidateAdmin(qc);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      await withRecentAuth(() =>
        adminUsersAssignRole(user.id, {
          role,
          ...(role !== 'super_admin' ? { institutionId } : {}),
        }),
      );
      await refresh();
      toast.success(`${ROLE_LABELS[role]} granted`);
      setRole('');
      setInstitutionId('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const suspended = user.status === 'suspended';

  return (
    <>
      <Link
        href="/administrators"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Administrators
      </Link>
      <PageHeader
        title={name}
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {user.email} {STATUS_BADGE[user.status]}
          </span>
        }
        actions={
          canSuspend &&
          !isSelf &&
          user.status !== 'invited' && (
            <Button
              variant={suspended ? 'secondary' : 'danger'}
              onClick={() => setConfirmStatus(true)}
            >
              {suspended ? 'Reactivate' : 'Suspend'}
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Roles"
            description="Each role applies to one institution, except Super Administrator, which is platform-wide."
          />
          <ul className="divide-y divide-border">
            {user.assignments.length === 0 && (
              <li className="px-5 py-4 text-sm text-muted">No roles you can see.</li>
            )}
            {user.assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ROLE_TONE[a.role as Role]}>{ROLE_LABELS[a.role as Role]}</Badge>
                  <span className="text-sm text-muted">
                    {a.institutionName ?? 'All institutions'}
                  </span>
                </div>
                {canManageAssignment(a) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevoking(a)}
                    aria-label={`Revoke ${ROLE_LABELS[a.role as Role]}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {roles.length > 0 && (
            <form onSubmit={grant} className="flex flex-col gap-3 border-t border-border px-5 py-4">
              <h3 className="text-[13px] font-semibold">Grant a role</h3>
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Role">
                  {(p) => (
                    <Select
                      {...p}
                      value={role}
                      onChange={(e) => {
                        setRole(e.target.value as Role);
                        setInstitutionId('');
                      }}
                    >
                      <option value="">Select a role</option>
                      {roleOptions(roles).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Institution">
                  {(p) => (
                    <Select
                      {...p}
                      value={institutionId}
                      onChange={(e) => setInstitutionId(e.target.value)}
                      disabled={!role || role === 'super_admin'}
                    >
                      <option value="">
                        {role === 'super_admin' ? 'Platform-wide' : 'Select an institution'}
                      </option>
                      {instOptions.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!role || (role !== 'super_admin' && !institutionId)}
                >
                  Grant
                </Button>
              </div>
            </form>
          )}
        </Card>
        <Card>
          <CardHeader title="Account" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 px-5 py-4 text-[13px]">
            <dt className="text-muted">Two-step</dt>
            <dd>
              {user.mfaEnabled ? (
                <Badge tone="success">Enabled</Badge>
              ) : (
                <Badge tone="warning">Not enabled</Badge>
              )}
            </dd>
            <dt className="text-muted">Last sign-in</dt>
            <dd>{fmtDate(user.lastLoginAt)}</dd>
            <dt className="text-muted">Created</dt>
            <dd>{fmtDate(user.createdAt)}</dd>
          </dl>
        </Card>
      </div>

      {revoking && (
        <ConfirmDialog
          open
          onClose={() => setRevoking(null)}
          title="Revoke role?"
          body={
            <>
              {name} will lose <strong>{ROLE_LABELS[revoking.role as Role]}</strong>
              {revoking.institutionName ? ` at ${revoking.institutionName}` : ''} immediately.
            </>
          }
          confirmLabel="Revoke role"
          onConfirm={async () => {
            try {
              await withRecentAuth(() => adminUsersRevokeRole(user.id, revoking.id));
              await refresh();
              toast.success('Role revoked');
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      )}
      <ConfirmDialog
        open={confirmStatus}
        onClose={() => setConfirmStatus(false)}
        title={suspended ? `Reactivate ${name}?` : `Suspend ${name}?`}
        body={
          suspended
            ? 'They will be able to sign in again with their existing roles.'
            : 'They are signed out everywhere immediately and cannot sign in until reactivated.'
        }
        confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
        tone={suspended ? 'primary' : 'danger'}
        onConfirm={async () => {
          try {
            await withRecentAuth(() =>
              suspended ? adminUsersReactivate(user.id) : adminUsersSuspend(user.id),
            );
            await refresh();
            toast.success(suspended ? 'Administrator reactivated' : 'Administrator suspended');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
