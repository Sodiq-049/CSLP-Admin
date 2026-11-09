'use client';

import { useInsightsEngagement, type Engagement } from '@cslp/api-client';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/states';
import { DataTable, type Column } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { useInstitution } from '@/lib/institution';

type CourseRow = Engagement['courses'][number];
type MaterialRow = Engagement['materials'][number];

const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n)}%`);

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fg tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-subtle">{hint}</div>}
    </div>
  );
}

/** Horizontal meter: value is shown as text too, so colour is never the only signal. */
function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-[13px] tabular-nums">{v}%</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const { current } = useInstitution();
  const q = useInsightsEngagement(current ? { institutionId: current.id } : {});
  const d = q.data?.data;

  const courseCols: Column<CourseRow>[] = [
    {
      key: 'course',
      header: 'Course',
      cell: (c) => (
        <div className="min-w-0">
          <span className="block font-medium text-fg">{c.code}</span>
          <span className="block truncate text-[12.5px] text-muted">{c.title}</span>
        </div>
      ),
    },
    {
      key: 'enrol',
      header: 'Enrolled',
      cell: (c) => <span className="tabular-nums">{c.enrolments}</span>,
      className: 'w-24',
    },
    {
      key: 'completion',
      header: 'Material completion',
      cell: (c) => <Meter value={c.completionPercent} label={`${c.code} completion`} />,
      className: 'hidden sm:table-cell',
    },
    {
      key: 'attempts',
      header: 'Quiz attempts',
      cell: (c) => <span className="tabular-nums">{c.quizAttempts}</span>,
      className: 'hidden md:table-cell w-28',
    },
    {
      key: 'avg',
      header: 'Avg. quiz score',
      cell: (c) => <span className="tabular-nums">{pct(c.averageQuizPercent)}</span>,
      className: 'w-32',
    },
  ];
  const materialCols: Column<MaterialRow>[] = [
    {
      key: 'label',
      header: 'Material',
      cell: (m) => <span className="font-medium text-fg">{m.label}</span>,
    },
    {
      key: 'started',
      header: 'Started',
      cell: (m) => <span className="tabular-nums">{m.started}</span>,
      className: 'w-24',
    },
    {
      key: 'completed',
      header: 'Completed',
      cell: (m) => (
        <Meter
          value={m.started ? Math.round((m.completed / m.started) * 100) : 0}
          label={`${m.label} completion rate`}
        />
      ),
    },
    {
      key: 'avg',
      header: 'Avg. quiz score',
      cell: (m) => <span className="tabular-nums">{pct(m.averageQuizPercent)}</span>,
      className: 'hidden sm:table-cell w-32',
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={current ? `${current.shortName} · ${current.name}` : 'All institutions'}
        title="Analytics"
        description="How students use published materials. Figures come from student activity only; drafts are never counted."
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Enrolments" value={d.enrolments} />
            <Tile label="Active learners" value={d.activeLearners30d} hint="Last 30 days" />
            <Tile label="Materials completed" value={d.completions} />
            <Tile label="Quiz attempts" value={d.quizAttempts} />
            <Tile label="Average quiz score" value={pct(d.averageQuizPercent)} />
          </div>
          <Card className="mt-6">
            <CardHeader title="Courses" description="Ordered by enrolments." />
            <DataTable
              caption="Course engagement"
              columns={courseCols}
              rows={d.courses}
              rowKey={(c) => c.courseId}
              empty={
                <EmptyState
                  title="No student activity yet"
                  body="Publish a course and share it with students to see engagement here."
                />
              }
            />
          </Card>
          <Card className="mt-6">
            <CardHeader
              title="Most-used materials"
              description="Top 20 by students who started them."
            />
            <DataTable
              caption="Material engagement"
              columns={materialCols}
              rows={d.materials}
              rowKey={(m) => m.materialId}
              empty={<EmptyState title="No materials opened yet" />}
            />
          </Card>
        </>
      ) : null}
    </>
  );
}
