'use client';

import Link from 'next/link';
import { useOutlinesDrafts, type OutlineReviewItem } from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/query';

const EXTRACTION: Record<string, React.ReactNode> = {
  pending: <Badge tone="info">Processing</Badge>,
  extracting: <Badge tone="info">Processing</Badge>,
  suggested: <Badge tone="warning">Ready for review</Badge>,
  failed: <Badge tone="danger">Detection failed</Badge>,
  none: <Badge>Manual</Badge>,
};

export default function OutlinesPage() {
  const list = useOutlinesDrafts({ query: { refetchInterval: 5000 } });
  const columns: Column<OutlineReviewItem>[] = [
    {
      key: 'course',
      header: 'Course',
      cell: (i) => (
        <Link href={`/courses/${i.course.id}?tab=outline`} className="group block">
          <code className="mr-2 font-semibold">{i.course.code}</code>
          <span className="text-fg group-hover:text-primary group-hover:underline">
            {i.course.title}
          </span>
        </Link>
      ),
    },
    { key: 'version', header: 'Version', className: 'w-24', cell: (i) => `v${i.outline.version}` },
    {
      key: 'topics',
      header: 'Topics',
      className: 'hidden w-24 sm:table-cell',
      cell: (i) => i.outline.structure.length,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-40',
      cell: (i) => EXTRACTION[i.outline.extraction.status],
    },
    {
      key: 'updated',
      header: 'Updated',
      className: 'hidden md:table-cell',
      cell: (i) => <span className="text-[13px] text-muted">{fmtDate(i.outline.updatedAt)}</span>,
    },
  ];
  return (
    <>
      <PageHeader
        title="Course outlines"
        description="Draft outlines across your courses that still need checking and approval."
      />
      <Card>
        <DataTable
          caption="Draft outlines"
          columns={columns}
          rows={list.data?.data}
          rowKey={(i) => i.outline.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title="Nothing waiting for review"
              body="Add an outline from a course’s Outline tab."
            />
          }
        />
      </Card>
    </>
  );
}
