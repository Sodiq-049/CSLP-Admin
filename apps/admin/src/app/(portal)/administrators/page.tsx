'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  adminUsersInvite,
  useAdminUsersList,
  type AdminUser,
  type AdminUsersListParams,
} from '@cslp/api-client';
import { ROLE_LABELS, USER_STATUSES, type Role } from '@cslp/shared-types';
import { InviteAdminRequestSchema } from '@cslp/validation';
import {
  grantableInstitutions,
  grantableRoles,
  roleOptions,
  ROLE_TONE,
} from '@/components/role-options';
import { useRecentAuth } from '@/components/shell/reauth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan, useMe } from '@/lib/auth';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { useInstitution } from '@/lib/institution';
import { fmtDate, invalidateAdmin } from '@/lib/query';

type InviteValues = z.input<typeof InviteAdminRequestSchema>;

export const STATUS_BADGE: Record<string, React.ReactNode> = {
  active: (
    <Badge tone="success" dot>
      Active
    </Badge>
  ),
  invited: <Badge tone="info">Invited</Badge>,
  suspended: <Badge tone="danger">Suspended</Badge>,
  deactivated: <Badge>Deactivated</Badge>,
};

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const { institutions, current } = useInstitution();
  const withRecentAuth = useRecentAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const roles = grantableRoles(me);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<InviteValues>({
    resolver: zodResolver(InviteAdminRequestSchema),
    defaultValues: {
      email: '',
      role: roles.includes('content_manager') ? 'content_manager' : roles[0],
      institutionId: current?.id,
    },
  });
  const role = form.watch('role') as Role | undefined;
  const instOptions = grantableInstitutions(me, institutions, role);
  const e = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await withRecentAuth(() =>
        adminUsersInvite({
          email: v.email,
          role: v.role,
          ...(v.firstName ? { firstName: v.firstName } : {}),
          ...(v.lastName ? { lastName: v.lastName } : {}),
          ...(v.role !== 'super_admin' && v.institutionId
            ? { institutionId: v.institutionId }
            : {}),
        }),
      );
      await invalidateAdmin(qc);
      toast.success(`Invitation sent to ${v.email}`);
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
      title="Invite administrator"
      description="They’ll receive an email link (valid 72 hours) to set a password."
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Email" required error={e.email?.message}>
          {(p) => <Input {...p} type="email" {...form.register('email')} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" error={e.firstName?.message}>
            {(p) => (
              <Input
                {...p}
                {...form.register('firstName', { setValueAs: (v: string) => v || undefined })}
              />
            )}
          </Field>
          <Field label="Last name" error={e.lastName?.message}>
            {(p) => (
              <Input
                {...p}
                {...form.register('lastName', { setValueAs: (v: string) => v || undefined })}
              />
            )}
          </Field>
        </div>
        <Field label="Role" required error={e.role?.message}>
          {(p) => (
            <Select {...p} {...form.register('role')}>
              {roleOptions(roles).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {role !== 'super_admin' && (
          <Field label="Institution" required error={e.institutionId?.message}>
            {(p) => (
              <Select
                {...p}
                {...form.register('institutionId', { setValueAs: (v: string) => v || undefined })}
              >
                <option value="">Select an institution</option>
                {instOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            Send invitation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function AdministratorsPage() {
  const canInvite = useCan('admin_user.invite');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [inviting, setInviting] = useState(false);
  const params: AdminUsersListParams = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(role ? { role: role as Role } : {}),
    ...(status ? { status: status as AdminUsersListParams['status'] } : {}),
  };
  const list = useAdminUsersList(params);

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: 'Administrator',
      cell: (u) => (
        <Link href={`/administrators/${u.id}`} className="group block min-w-0">
          <span className="block font-medium text-fg group-hover:text-primary group-hover:underline">
            {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
          </span>
          <span className="block truncate text-[12.5px] text-muted">
            {u.firstName || u.lastName
              ? u.email
              : u.status === 'invited'
                ? 'Invitation pending'
                : ''}
          </span>
        </Link>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.assignments.map((a) => (
            <Badge key={a.id} tone={ROLE_TONE[a.role as Role]}>
              {ROLE_LABELS[a.role as Role]}
              {a.institutionName ? ` · ${a.institutionName}` : ''}
            </Badge>
          ))}
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (u) => STATUS_BADGE[u.status] },
    {
      key: 'mfa',
      header: 'MFA',
      cell: (u) =>
        u.mfaEnabled ? (
          <ShieldCheck className="size-4 text-success" aria-label="MFA enabled" />
        ) : (
          <ShieldOff className="size-4 text-subtle" aria-label="MFA not enabled" />
        ),
      className: 'hidden sm:table-cell w-16',
    },
    {
      key: 'last',
      header: 'Last sign-in',
      cell: (u) => <span className="text-[13px] text-muted">{fmtDate(u.lastLoginAt)}</span>,
      className: 'hidden lg:table-cell',
    },
  ];

  return (
    <>
      <PageHeader
        title="Administrators"
        description="Staff with access to the portal. Permissions are always enforced by the API per institution."
        actions={
          canInvite && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="size-4" aria-hidden /> Invite
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search name or email"
          />
          <Select
            aria-label="Filter by role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-52"
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">Any status</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          caption="Administrators"
          columns={columns}
          rows={list.data?.data}
          rowKey={(u) => u.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={<EmptyState title="No administrators match" />}
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
      {canInvite && <InviteDialog open={inviting} onClose={() => setInviting(false)} />}
    </>
  );
}
