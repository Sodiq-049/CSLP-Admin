'use client';

import Link from 'next/link';
import { useContentQueue, type ReviewQueueItem } from '@cslp/api-client';
import { KIND_LABEL } from '@/components/content/labels';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/query';

export default function ReviewsPage() {
  const q = useContentQueue({ query: { refetchInterval: 15_000 } });
  const columns: Column<ReviewQueueItem>[] = [
    {
      key: 'item',
      header: 'Content',
      cell: (i) => (
        <Link href={`/content/versions/${i.versionId}`} className="group block">
          <span className="font-medium text-fg group-hover:text-primary group-hover:underline">
            {i.topicTitle}
          </span>
          <span className="block text-[12.5px] text-muted">
            {KIND_LABEL[i.kind]} · v{i.versionNumber} · <code>{i.courseCode}</code> {i.courseTitle}
          </span>
        </Link>
      ),
    },
    {
      key: 'flags',
      header: 'Flags',
      className: 'hidden sm:table-cell',
      cell: (i) => (i.insufficientSources ? <Badge tone="warning">Limited sources</Badge> : null),
    },
    {
      key: 'by',
      header: 'Submitted by',
      className: 'hidden md:table-cell',
      cell: (i) => i.submittedByName,
    },
    {
      key: 'at',
      header: 'Waiting since',
      cell: (i) => <span className="text-[13px] text-muted">{fmtDate(i.submittedAt)}</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Content reviews"
        description="Versions waiting for academic review, oldest first. You can’t review content you created or submitted."
      />
      <Card>
        <DataTable
          caption="Review queue"
          columns={columns}
          rows={q.data?.data}
          rowKey={(i) => i.versionId}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Nothing to review" body="Submitted drafts appear here." />}
        />
      </Card>
    </>
  );
}
