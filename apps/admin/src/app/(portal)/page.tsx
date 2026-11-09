'use client';

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileUp,
  Rocket,
  Sparkles,
  Video,
  ClipboardCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useHealthCheck, useInsightsOverview, useInstitutionsTree } from '@cslp/api-client';
import { ROLE_LABELS, type Role } from '@cslp/shared-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/states';
import { useMe } from '@/lib/auth';
import { useInstitution } from '@/lib/institution';
import { fmtDate } from '@/lib/query';

const SHORTCUTS = [
  { label: 'Add New Course', icon: BookOpen, href: '/courses/new' },
  { label: 'Upload Course Outline', icon: FileUp, href: '/outlines' },
  { label: 'Generate AI Notes', icon: Sparkles, href: '/studio' },
  { label: 'Open AI Video Studio', icon: Video, comingSoon: true },
  { label: 'Review Pending Content', icon: ClipboardCheck, href: '/reviews' },
  { label: 'Publish Approved Materials', icon: Rocket, href: '/publishing' },
];

/** "content_version.submit" → "Content version submit" */
const actionLabel = (a: string) => {
  const t = a.replace(/[._]/g, ' ');
  return t[0]!.toUpperCase() + t.slice(1);
};
const fmtNum = (n: number) =>
  new Intl.NumberFormat('en-NG', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n);

function Stat({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fg tabular-nums">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function OverviewPage() {
  const me = useMe();
  const { current } = useInstitution();
  const tree = useInstitutionsTree(current?.id ?? '', { query: { enabled: !!current } });
  const health = useHealthCheck({ query: { refetchInterval: 60_000 } });
  const overview = useInsightsOverview({ query: { refetchInterval: 120_000 } });
  const t = tree.data?.data;
  const c = overview.data?.data.counts;
  const v = (n: number | undefined) => (n === undefined ? '–' : fmtNum(n));
  const activity = overview.data?.data.recentActivity ?? [];
  const departments = t?.faculties.flatMap((f) => f.departments) ?? [];
  const programmes = departments.flatMap((d) => d.programmes);
  const levels = programmes.flatMap((p) => p.levels);

  return (
    <>
      <PageHeader
        eyebrow={current ? `${current.shortName} · ${current.name}` : undefined}
        title={`Welcome${me.firstName ? `, ${me.firstName}` : ''}`}
        description="Set up the academic structure, then create courses and generate, review and publish learning materials."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Courses" value={v(c?.courses)} href="/courses" />
        <Stat label="Published lessons" value={v(c?.publishedLessons)} href="/publishing" />
        <Stat label="Awaiting review" value={v(c?.awaitingReview)} href="/reviews" />
        <Stat label="Registered students" value={v(c?.registeredStudents)} href="/students" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drafts in progress" value={v(c?.draftLessons)} href="/studio" />
        <Stat label="Questions to review" value={v(c?.questionsAwaitingReview)} href="/quizzes" />
        <Stat label="Active students (30 days)" value={v(c?.activeStudents30d)} href="/analytics" />
        <Stat label="AI calls this month" value={v(c?.aiCallsThisMonth)} href="/ai-usage" />
      </div>
      <h2 className="mt-6 mb-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
        Academic structure{current ? ` · ${current.shortName}` : ''}
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Faculties" value={t?.faculties.length ?? '–'} href="/structure/faculties" />
        <Stat
          label="Departments"
          value={t ? departments.length : '–'}
          href="/structure/departments"
        />
        <Stat label="Programmes" value={t ? programmes.length : '–'} href="/structure/programmes" />
        <Stat label="Academic levels" value={t ? levels.length : '–'} href="/structure/levels" />
        <Stat label="Semesters" value={t?.semesters.length ?? '–'} href="/structure/semesters" />
      </div>
      {!!c?.failedJobs30d && (
        <div className="mt-3">
          <Alert tone="warning">
            {c.failedJobs30d} AI job{c.failedJobs30d === 1 ? '' : 's'} failed in the last 30 days.
            Open the item in the Content Studio to retry.
          </Alert>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Quick actions" />
          <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
            {SHORTCUTS.map(
              ({
                label,
                icon: Icon,
                phase,
                href,
                comingSoon,
              }: {
                label: string;
                icon: typeof Video;
                phase?: number;
                href?: string;
                comingSoon?: boolean;
              }) =>
                href ? (
                  <li key={label} className="bg-surface">
                    <Link
                      href={href}
                      className="group flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2"
                    >
                      <span className="rounded-md bg-primary-soft p-2 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex-1 text-sm font-medium text-fg">{label}</span>
                      <ArrowRight
                        className="size-4 text-muted transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ) : (
                  <li key={label} className="flex items-center gap-3 bg-surface px-5 py-3.5">
                    <span className="rounded-md bg-surface-2 p-2 text-muted">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex-1 text-sm text-muted">{label}</span>
                    <Badge>{comingSoon ? 'Coming soon' : `Phase ${phase}`}</Badge>
                  </li>
                ),
            )}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Recent activity" />
            {activity.length ? (
              <ul className="flex flex-col divide-y divide-border">
                {activity.map((a, i) => (
                  <li key={i} className="px-5 py-2.5 text-sm">
                    <div className="text-fg">{actionLabel(a.action)}</div>
                    <div className="text-[12.5px] text-muted">
                      {a.actorName} · {fmtDate(a.at)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">
                {overview.isLoading ? 'Loading…' : 'No activity yet.'}
              </p>
            )}
          </Card>
          <Card>
            <CardHeader title="Your access" />
            <ul className="flex flex-col gap-2 px-5 py-4">
              {me.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{ROLE_LABELS[a.role as Role]}</span>
                  <span className="truncate text-[12.5px] text-muted">
                    {a.institutionName ?? 'All institutions'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Platform status" />
            <div className="flex items-center gap-2 px-5 py-4 text-sm">
              {health.data?.data.status === 'ok' ? (
                <>
                  <CheckCircle2 className="size-4 text-success" aria-hidden /> API and database
                  operational
                </>
              ) : health.isLoading ? (
                <span className="text-muted">Checking…</span>
              ) : (
                <span className="text-warning">Degraded: some services are unavailable</span>
              )}
            </div>
          </Card>
          {!t?.faculties.length && current && (
            <Link
              href="/structure/faculties"
              className="group flex items-center justify-between rounded-lg border border-primary/30 bg-primary-soft px-5 py-4 text-sm font-medium text-primary"
            >
              Start by adding a faculty
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
