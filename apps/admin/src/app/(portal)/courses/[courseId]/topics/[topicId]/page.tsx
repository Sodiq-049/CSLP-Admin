'use client';

import { useQueryClient } from '@tanstack/react-query';
import { publishingPublishTopic, publishingUnpublishTopic } from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/errors';
import { invalidateAdmin } from '@/lib/query';

import { ArrowLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  useContentMaterials,
  useCoursesGet,
  useCoursesTree,
  type GenerationBatch,
} from '@cslp/api-client';
import { GenerateForm } from '@/components/content/generate-form';
import { ComposeQuizDialog } from '@/components/content/compose-quiz-dialog';
import { JobProgress } from '@/components/content/job-progress';
import { DisplayStatusBadge, KIND_LABEL } from '@/components/content/labels';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, Spinner } from '@/components/ui/states';
import { useCan } from '@/lib/auth';
import { fmtDate } from '@/lib/query';

export default function TopicContentPage() {
  const { courseId, topicId } = useParams<{ courseId: string; topicId: string }>();
  const course = useCoursesGet(courseId).data?.data;
  const tree = useCoursesTree(courseId).data?.data ?? [];
  const topic = tree.flatMap((t) => [t, ...t.subtopics]).find((t) => t.id === topicId);
  const parentNode = tree.find((t) => t.id === topicId);
  const materials = useContentMaterials(topicId, {
    query: {
      refetchInterval: (q) =>
        q.state.data?.data.some((m) => m.displayStatus === 'generating') ? 2000 : false,
    },
  });
  const canGenerate = useCan('content.generate', course?.institutionId);
  const canComposeQuiz = useCan('quiz.manage', course?.institutionId);
  const canPublishTopic = useCan('content.publish', course?.institutionId);
  const qc = useQueryClient();
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(false);
  const [batch, setBatch] = useState<GenerationBatch | null>(null);

  if (!course || !topic) return <Spinner />;
  return (
    <>
      <Link
        href={`/courses/${courseId}?tab=topics`}
        className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {course.code} · Topics
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            {course.code} · {course.title}
            {topic.publication.state === 'published' ? (
              <Badge tone="success" dot>
                Topic visible to students
              </Badge>
            ) : (
              <Badge>Topic not published</Badge>
            )}
          </span>
        }
        title={topic.title}
        description={
          parentNode?.subtopics.length
            ? `Subtopics: ${parentNode.subtopics.map((s) => s.title).join(', ')}`
            : undefined
        }
        actions={
          <>
            {canPublishTopic && (
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    if (topic.publication.state === 'published')
                      await publishingUnpublishTopic(topic.id);
                    else await publishingPublishTopic(topic.id);
                    await invalidateAdmin(qc);
                    toast.success(
                      topic.publication.state === 'published'
                        ? 'Topic hidden from students'
                        : 'Topic published',
                    );
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                {topic.publication.state === 'published' ? 'Unpublish topic' : 'Publish topic'}
              </Button>
            )}
            {canComposeQuiz && (
              <Button variant="secondary" onClick={() => setComposing(true)}>
                Create quiz
              </Button>
            )}
            {canGenerate && (
              <Button
                onClick={() => {
                  setBatch(null);
                  setOpen(true);
                }}
              >
                <Sparkles className="size-4" aria-hidden /> Generate content
              </Button>
            )}
          </>
        }
      />
      <ComposeQuizDialog topicId={topicId} open={composing} onClose={() => setComposing(false)} />
      <Card>
        <CardHeader
          title="Learning materials"
          description="Each material keeps every version. Students only ever see a published, approved version."
        />
        {materials.isLoading ? (
          <Spinner />
        ) : !materials.data?.data.length ? (
          <EmptyState
            title="No materials yet"
            body="Generate notes or a revision pack from the approved sources, then review them."
            action={
              canGenerate ? (
                <Button onClick={() => setOpen(true)}>
                  <Sparkles className="size-4" aria-hidden /> Generate content
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {materials.data.data.map((m) => {
              const latest = m.versions[0];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{KIND_LABEL[m.kind]}</div>
                    <div className="text-[12.5px] text-muted">
                      {m.versions.length} version{m.versions.length === 1 ? '' : 's'} · updated{' '}
                      {fmtDate(m.updatedAt)}
                    </div>
                  </div>
                  <DisplayStatusBadge status={m.displayStatus} />
                  {latest && (
                    <Link href={`/content/versions/${m.currentDraftVersionId ?? latest.id}`}>
                      <Button variant="secondary" size="sm">
                        Open
                      </Button>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={batch ? 'Generating' : `Generate content for “${topic.title}”`}
        size="lg"
      >
        {batch ? (
          <div className="flex flex-col gap-4">
            <JobProgress batch={batch} topicTitle={() => topic.title} />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <GenerateForm courseId={courseId} topicIds={[topicId]} onStarted={setBatch} />
        )}
      </Dialog>
    </>
  );
}
