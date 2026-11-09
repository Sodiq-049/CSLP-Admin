'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MailCheck, MailWarning } from 'lucide-react';
import { useState } from 'react';
import {
  insightsSetStatus,
  useInsightsStudents,
  type InsightsStudentsParams,
  type StudentAccount,
} from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useInstitution } from '@/lib/institution';
import { fmtDate, invalidateAdmin } from '@/lib/query';

const STATUS: Record<string, React.ReactNode> = {
  active: (
    <Badge tone="success" dot>
      Active
    </Badge>
  ),
  suspended: <Badge tone="danger">Suspended</Badge>,
  invited: <Badge tone="info">Invited</Badge>,
  deactivated: <Badge>Deactivated</Badge>,
};

export default function StudentsPage() {
  const { current } = useInstitution();
  const canManage = useCan('student.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<StudentAccount | null>(null);
  const params: InsightsStudentsParams = {
    page,
    pageSize: 25,
    ...(current ? { institutionId: current.id } : {}),
    ...(q ? { q } : {}),
    ...(status ? { status: status as InsightsStudentsParams['status'] } : {}),
  };
  const list = useInsightsStudents(params);

  const columns: Column<StudentAccount>[] = [
    {
      key: 'name',
      header: 'Student',
      cell: (s) => (
        <div className="min-w-0">
          <span className="block font-medium text-fg">
            {`${s.firstName} ${s.lastName}`.trim() || s.email}
          </span>
          <span className="flex items-center gap-1 truncate text-[12.5px] text-muted">
            {s.emailVerified ? (
              <MailCheck className="size-3.5 text-success" aria-label="Email verified" />
            ) : (
              <MailWarning className="size-3.5 text-warning" aria-label="Email not verified" />
            )}
            {s.email}
          </span>
        </div>
      ),
    },
    {
      key: 'programme',
      header: 'Programme',
      cell: (s) => (
        <span className="text-[13px] text-muted">
          {[s.programme, s.level].filter(Boolean).join(' · ') || '–'}
        </span>
      ),
      className: 'hidden md:table-cell',
    },
    {
      key: 'enrolments',
      header: 'Courses',
      cell: (s) => <span className="tabular-nums">{s.enrolments}</span>,
      className: 'w-20',
    },
    { key: 'status', header: 'Status', cell: (s) => STATUS[s.status] },
    {
      key: 'joined',
      header: 'Joined',
      cell: (s) => <span className="text-[13px] text-muted">{fmtDate(s.createdAt)}</span>,
      className: 'hidden lg:table-cell',
    },
    {
      key: 'last',
      header: 'Last sign-in',
      cell: (s) => <span className="text-[13px] text-muted">{fmtDate(s.lastLoginAt)}</span>,
      className: 'hidden lg:table-cell',
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            cell: (s: StudentAccount) =>
              s.status === 'active' || s.status === 'suspended' ? (
                <Button size="sm" variant="secondary" onClick={() => setTarget(s)}>
                  {s.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
              ) : null,
            className: 'w-28 text-right',
          } satisfies Column<StudentAccount>,
        ]
      : []),
  ];

  const suspending = target?.status === 'active';
  return (
    <>
      <PageHeader
        title="Students"
        description="Students register themselves with their institution email and must verify it before signing in. Suspending a student signs them out immediately."
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
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </div>
        <DataTable
          caption="Students"
          columns={columns}
          rows={list.data?.data}
          rowKey={(s) => s.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title="No students yet"
              body="Students appear here once they register from the student website or app."
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
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={suspending ? 'Suspend student?' : 'Reactivate student?'}
        body={
          suspending
            ? `${target?.email} will be signed out and won’t be able to sign in until reactivated.`
            : `${target?.email} will be able to sign in again.`
        }
        confirmLabel={suspending ? 'Suspend' : 'Reactivate'}
        tone={suspending ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (!target) return;
          try {
            await insightsSetStatus(target.id, { status: suspending ? 'suspended' : 'active' });
            await invalidateAdmin(qc);
            toast.success(suspending ? 'Student suspended' : 'Student reactivated');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
