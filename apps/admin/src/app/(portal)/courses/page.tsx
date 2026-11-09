'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useCoursesList, type Course } from '@cslp/api-client';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { useCan } from '@/lib/auth';
import { useAcademicOptions } from '@/lib/academic-options';
import { errorMessage } from '@/lib/errors';

export function PublicationBadge({ state }: { state: Course['publication']['state'] }) {
  if (state === 'published')
    return (
      <Badge tone="success" dot>
        Published
      </Badge>
    );
  if (state === 'scheduled') return <Badge tone="violet">Scheduled</Badge>;
  if (state === 'archived') return <Badge>Archived</Badge>;
  return (
    <Badge tone="neutral" dot>
      Draft
    </Badge>
  );
}

function Courses({ institutionId }: { institutionId: string }) {
  const canCreate = useCan('course.create', institutionId);
  const opts = useAcademicOptions(institutionId);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [programmeId, setProgrammeId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const list = useCoursesList({
    institutionId,
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(programmeId ? { programmeId } : {}),
    ...(levelId ? { levelId } : {}),
    ...(semesterId ? { semesterId } : {}),
  });
  const reset = () => setPage(1);

  const columns: Column<Course>[] = [
    {
      key: 'code',
      header: 'Code',
      className: 'w-28',
      cell: (c) => <code className="text-[13px] font-semibold">{c.code}</code>,
    },
    {
      key: 'title',
      header: 'Course',
      cell: (c) => (
        <Link href={`/courses/${c.id}`} className="group block">
          <span className="font-medium text-fg group-hover:text-primary group-hover:underline">
            {c.title}
          </span>
          {c.isDemoData && (
            <Badge tone="warning" className="ml-2">
              Demo data
            </Badge>
          )}
          <span className="block text-[12.5px] text-muted">
            {c.labels.programme} · {c.labels.level} · {c.labels.semester}
          </span>
        </Link>
      ),
    },
    {
      key: 'units',
      header: 'Units',
      className: 'hidden w-20 sm:table-cell',
      cell: (c) => c.creditUnits,
    },
    {
      key: 'topics',
      header: 'Topics',
      className: 'hidden w-20 md:table-cell',
      cell: (c) => c.topicCount,
    },
    {
      key: 'outline',
      header: 'Outline',
      className: 'hidden w-28 lg:table-cell',
      cell: (c) =>
        c.activeOutlineId ? <Badge tone="success">Approved</Badge> : <Badge>None</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
      cell: (c) => <PublicationBadge state={c.publication.state} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Courses"
        description="Courses stay in draft until they are published from the Publishing Centre."
        actions={
          canCreate && (
            <Link href="/courses/new">
              <Button>
                <Plus className="size-4" aria-hidden /> New course
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              reset();
            }}
            placeholder="Search code or title"
          />
          <Select
            aria-label="Programme"
            value={programmeId}
            onChange={(e) => {
              setProgrammeId(e.target.value);
              setLevelId('');
              reset();
            }}
            className="w-full sm:w-56"
          >
            <option value="">All programmes</option>
            {opts.programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Level"
            value={levelId}
            onChange={(e) => {
              setLevelId(e.target.value);
              reset();
            }}
            className="w-full sm:w-36"
            disabled={!programmeId}
          >
            <option value="">All levels</option>
            {opts.levelsFor(programmeId).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Semester"
            value={semesterId}
            onChange={(e) => {
              setSemesterId(e.target.value);
              reset();
            }}
            className="w-full sm:w-44"
          >
            <option value="">All semesters</option>
            {opts.semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          caption="Courses"
          columns={columns}
          rows={list.data?.data}
          rowKey={(c) => c.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title={q || programmeId || semesterId ? 'No matching courses' : 'No courses yet'}
              body={
                !opts.programmes.length
                  ? 'Set up programmes and levels first, then add courses.'
                  : canCreate
                    ? 'Add the first course for this institution.'
                    : undefined
              }
              action={
                canCreate && !q && opts.programmes.length > 0 ? (
                  <Link href="/courses/new">
                    <Button>New course</Button>
                  </Link>
                ) : undefined
              }
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
    </>
  );
}

export default function CoursesPage() {
  return (
    <RequireInstitution>{(i) => <Courses key={i.id} institutionId={i.id} />}</RequireInstitution>
  );
}
