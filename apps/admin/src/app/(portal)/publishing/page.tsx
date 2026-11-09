'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  publishingCancel,
  publishingPublishCourse,
  publishingPublishTopic,
  usePublishingEvents,
  usePublishingOverview,
  type PublishingOverview,
} from '@cslp/api-client';

type PublishingItem = PublishingOverview['ready'][number];
import { KIND_LABEL } from '@/components/content/labels';
import { PublishActionDialog, type PublishAction } from '@/components/publishing/publish-dialogs';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, Spinner } from '@/components/ui/states';
import { Pagination } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { fmtDate, invalidateAdmin } from '@/lib/query';

const TABS = [
  { id: 'ready', label: 'Ready to publish' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'history', label: 'History' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const ACTION_LABEL: Record<string, string> = {
  publish: 'Published',
  schedule: 'Scheduled',
  cancel_schedule: 'Schedule cancelled',
  unpublish: 'Unpublished',
  rollback: 'Rolled back',
  publish_course: 'Course published',
  unpublish_course: 'Course unpublished',
  publish_topic: 'Topic published',
  unpublish_topic: 'Topic unpublished',
};

function Visibility({ i, institutionId }: { i: PublishingItem; institutionId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canCourse = useCan('course.publish', institutionId);
  const canTopic = useCan('content.publish', institutionId);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await invalidateAdmin(qc);
      toast.success(msg);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (i.coursePublished && i.topicPublished)
    return <span className="text-[12.5px] text-success">Visible chain complete</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      {!i.coursePublished &&
        (canCourse ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act(() => publishingPublishCourse(i.courseId), 'Course published')}
          >
            Publish course
          </Button>
        ) : (
          <Badge tone="warning">Course not published</Badge>
        ))}
      {!i.topicPublished &&
        (canTopic ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act(() => publishingPublishTopic(i.topicId), 'Topic published')}
          >
            Publish topic
          </Button>
        ) : (
          <Badge tone="warning">Topic not published</Badge>
        ))}
    </div>
  );
}

function Items({
  items,
  tab,
  institutionId,
  onAction,
}: {
  items: PublishingItem[];
  tab: Tab;
  institutionId: string;
  onAction: (a: PublishAction) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const canPublish = useCan('content.publish', institutionId);
  const canSchedule = useCan('content.schedule', institutionId);
  const canUnpublish = useCan('content.unpublish', institutionId);
  const canRollback = useCan('content.rollback', institutionId);
  if (!items.length) {
    const empty = {
      ready: 'Nothing is waiting. Approved content appears here.',
      scheduled: 'Nothing is scheduled.',
      published: 'Nothing is published yet.',
      history: '',
    };
    return <EmptyState title={empty[tab]} />;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => {
        const label = `${i.courseCode} · ${i.topicTitle} · ${KIND_LABEL[i.kind]}`;
        const warnings = [
          !i.coursePublished && `The course ${i.courseCode} is not published yet`,
          !i.topicPublished && `The topic “${i.topicTitle}” is not published yet`,
        ].filter(Boolean) as string[];
        return (
          <li
            key={i.materialId + tab}
            className="flex flex-col gap-2 px-5 py-3.5 lg:flex-row lg:items-center"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={`/content/versions/${tab === 'published' ? i.publishedVersionId : i.latestApprovedVersionId}`}
                className="text-sm font-medium text-fg hover:text-primary hover:underline"
              >
                {i.topicTitle} · {KIND_LABEL[i.kind]}
              </Link>
              <div className="text-[12.5px] text-muted">
                <code>{i.courseCode}</code> {i.courseTitle}
                {tab === 'ready' &&
                  ` · approved v${i.latestApprovedVersionNumber}${i.publishedVersionNumber ? ` (students see v${i.publishedVersionNumber})` : ''}`}
                {tab === 'scheduled' && ` · ${fmtDate(i.scheduledFor)}`}
                {tab === 'published' &&
                  ` · v${i.publishedVersionNumber} since ${fmtDate(i.publishedAt)}${i.latestApprovedVersionNumber && i.latestApprovedVersionNumber !== i.publishedVersionNumber ? ` · v${i.latestApprovedVersionNumber} approved` : ''}`}
              </div>
            </div>
            <Visibility i={i} institutionId={institutionId} />
            <div className="flex flex-wrap gap-1.5">
              {tab === 'ready' && canPublish && (
                <Button
                  size="sm"
                  onClick={() =>
                    onAction({
                      kind: 'publish',
                      materialId: i.materialId,
                      versionId: i.latestApprovedVersionId!,
                      label,
                      warnings,
                    })
                  }
                >
                  Publish
                </Button>
              )}
              {tab === 'ready' && canSchedule && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onAction({
                      kind: 'schedule',
                      materialId: i.materialId,
                      versionId: i.latestApprovedVersionId!,
                      label,
                    })
                  }
                >
                  Schedule
                </Button>
              )}
              {tab === 'scheduled' && canSchedule && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await publishingCancel(i.materialId);
                      await invalidateAdmin(qc);
                      toast.success('Schedule cancelled');
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  Cancel schedule
                </Button>
              )}
              {tab === 'published' && canRollback && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onAction({
                      kind: 'rollback',
                      materialId: i.materialId,
                      topicId: i.topicId,
                      currentVersionId: i.publishedVersionId,
                      label,
                    })
                  }
                >
                  Roll back
                </Button>
              )}
              {tab === 'published' && canUnpublish && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => onAction({ kind: 'unpublish', materialId: i.materialId, label })}
                >
                  Unpublish
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function History({ institutionId }: { institutionId: string }) {
  const [page, setPage] = useState(1);
  const q = usePublishingEvents({ institutionId, page, pageSize: 25 });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.data.length) return <EmptyState title="No publishing activity yet" />;
  return (
    <>
      <ul className="divide-y divide-border">
        {q.data.data.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-[13px]"
          >
            <Badge
              tone={
                e.action.startsWith('unpublish')
                  ? 'warning'
                  : e.action === 'rollback'
                    ? 'violet'
                    : 'success'
              }
            >
              {ACTION_LABEL[e.action] ?? e.action}
            </Badge>
            <span className="font-medium">{e.label}</span>
            {(e.fromVersionNumber || e.toVersionNumber) && (
              <span className="text-muted">
                {e.fromVersionNumber ? `v${e.fromVersionNumber} → ` : ''}
                {e.toVersionNumber ? `v${e.toVersionNumber}` : 'hidden'}
              </span>
            )}
            {e.reason && <span className="text-muted">“{e.reason}”</span>}
            <span className="ml-auto text-[12px] text-subtle">
              {e.actorName} · {fmtDate(e.at)}
            </span>
          </li>
        ))}
      </ul>
      <Pagination page={page} pageSize={25} total={q.data.meta.total ?? 0} onPage={setPage} />
    </>
  );
}

function PublishingCentre({ institutionId }: { institutionId: string }) {
  const [tab, setTab] = useState<Tab>('ready');
  const [action, setAction] = useState<PublishAction | null>(null);
  const q = usePublishingOverview({ institutionId });
  const o = q.data?.data;
  const counts: Record<Tab, number | null> = {
    ready: o?.ready.length ?? null,
    scheduled: o?.scheduled.length ?? null,
    published: o?.published.length ?? null,
    history: null,
  };
  return (
    <>
      <PageHeader
        title="Publishing centre"
        description="Only approved content can be published. Students see a material when its course, topic and the material itself are all published."
      />
      <div
        role="tablist"
        aria-label="Publishing"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              tab === t.id
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
            {counts[t.id] !== null && (
              <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">
                {counts[t.id]}
              </span>
            )}
          </button>
        ))}
      </div>
      <Card>
        {tab === 'history' ? (
          <History institutionId={institutionId} />
        ) : q.isLoading || !o ? (
          <Spinner />
        ) : (
          <Items items={o[tab]} tab={tab} institutionId={institutionId} onAction={setAction} />
        )}
      </Card>
      <PublishActionDialog action={action} onClose={() => setAction(null)} />
    </>
  );
}

export default function PublishingPage() {
  return (
    <RequireInstitution>
      {(i) => <PublishingCentre key={i.id} institutionId={i.id} />}
    </RequireInstitution>
  );
}
