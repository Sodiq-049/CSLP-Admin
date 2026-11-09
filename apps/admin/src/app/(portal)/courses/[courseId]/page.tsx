'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  coursesArchive,
  coursesUpdate,
  publishingPublishCourse,
  publishingUnpublishCourse,
  useCoursesGet,
} from '@cslp/api-client';
import { CourseForm, toPayload } from '@/components/courses/course-form';
import { OutlinePanel } from '@/components/courses/outline-panel';
import { TopicsPanel } from '@/components/courses/topics-panel';
import { SourceLibrary } from '@/components/sources/source-library';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { ConfirmDialog } from '@/components/ui/confirm';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';
import { PublicationBadge } from '../page';

const TABS = [
  { id: 'topics', label: 'Topics' },
  { id: 'outline', label: 'Outline' },
  { id: 'sources', label: 'Sources' },
  { id: 'details', label: 'Details' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const query = useCoursesGet(courseId);
  const course = query.data?.data;
  const canUpdate = useCan('course.update', course?.institutionId);
  const canArchive = useCan('course.archive', course?.institutionId);
  const canPublishCourse = useCan('course.publish', course?.institutionId);
  const [archiving, setArchiving] = useState(false);
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'topics') as Tab;

  if (query.isLoading) return <Spinner />;
  if (query.error || !course)
    return (
      <ErrorState
        message={errorMessage(query.error, 'Course not found.')}
        onRetry={() => query.refetch()}
      />
    );
  const readOnly = !!course.archivedAt;

  return (
    <>
      <Link
        href="/courses"
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Courses
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <code className="font-semibold text-fg">{course.code}</code> · {course.labels.programme}{' '}
            · {course.labels.level} · {course.labels.semester} · {course.creditUnits} units{' '}
            <PublicationBadge state={course.publication.state} />
          </span>
        }
        title={course.title}
        actions={
          <>
            {canPublishCourse && !course.archivedAt && (
              <Button
                variant={course.publication.state === 'published' ? 'secondary' : 'primary'}
                onClick={async () => {
                  try {
                    if (course.publication.state === 'published')
                      await publishingUnpublishCourse(course.id);
                    else await publishingPublishCourse(course.id);
                    await invalidateAdmin(qc);
                    toast.success(
                      course.publication.state === 'published'
                        ? 'Course hidden from students'
                        : 'Course published',
                    );
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                {course.publication.state === 'published' ? 'Unpublish course' : 'Publish course'}
              </Button>
            )}
            {canArchive && !course.archivedAt && (
              <Button variant="secondary" onClick={() => setArchiving(true)}>
                Archive
              </Button>
            )}
          </>
        }
      />
      {course.isDemoData && (
        <div className="mb-4">
          <Alert tone="warning">
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert className="size-4" aria-hidden /> Demonstration data: this is not an
              official course record.
            </span>
          </Alert>
        </div>
      )}
      {course.archivedAt && (
        <div className="mb-4">
          <Alert tone="info">This course is archived and read-only.</Alert>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Course sections"
        className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => router.replace(`/courses/${courseId}?tab=${t.id}`, { scroll: false })}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
              tab === t.id
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.id === 'topics' && (
              <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">
                {course.topicCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`}>
        {tab === 'topics' && <TopicsPanel course={course} readOnly={readOnly} />}
        {tab === 'outline' && <OutlinePanel course={course} readOnly={readOnly} />}
        {tab === 'sources' && (
          <SourceLibrary institutionId={course.institutionId} courseId={course.id} />
        )}
        {tab === 'details' && (
          <Card className="px-5 py-5">
            <CourseForm
              key={course.updatedAt}
              institutionId={course.institutionId}
              course={course}
              disabled={!canUpdate || readOnly}
              submitLabel="Save changes"
              onSubmit={async (v) => {
                await coursesUpdate(course.id, toPayload(v));
                await invalidateAdmin(qc);
                toast.success('Course saved');
              }}
            />
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={`Archive ${course.code}?`}
        body="The course becomes read-only and is hidden from lists. Its topics, outlines and sources are kept."
        confirmLabel="Archive course"
        onConfirm={async () => {
          try {
            await coursesArchive(course.id);
            await invalidateAdmin(qc);
            toast.success('Course archived');
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}

export default function CourseDetailPage() {
  return (
    <Suspense>
      <CourseDetail />
    </Suspense>
  );
}
