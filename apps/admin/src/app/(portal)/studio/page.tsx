'use client';

import { useState } from 'react';
import { useCoursesList, useCoursesTree, type GenerationBatch } from '@cslp/api-client';
import { GenerateForm } from '@/components/content/generate-form';
import { JobProgress } from '@/components/content/job-progress';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, Spinner } from '@/components/ui/states';

function Studio({ institutionId }: { institutionId: string }) {
  const courses = useCoursesList({ institutionId, pageSize: 100 });
  const [courseId, setCourseId] = useState('');
  const tree = useCoursesTree(courseId, undefined, { query: { enabled: !!courseId } });
  const topics = tree.data?.data ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<GenerationBatch | null>(null);
  const titleOf = (id: string) =>
    topics.flatMap((t) => [t, ...t.subtopics]).find((t) => t.id === id)?.title ?? 'Topic';

  return (
    <>
      <PageHeader
        title="AI Content Studio"
        description="Generate source-grounded drafts for one topic or many. Nothing reaches students until it is reviewed, approved and published."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader title="1. Choose topics" />
          <div className="flex flex-col gap-4 px-5 py-4">
            <Field label="Course">
              {(p) => (
                <Select
                  {...p}
                  value={courseId}
                  onChange={(e) => {
                    setCourseId(e.target.value);
                    setSelected([]);
                    setBatch(null);
                  }}
                >
                  <option value="">{courses.isLoading ? 'Loading…' : 'Select a course'}</option>
                  {courses.data?.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {courseId &&
              (tree.isLoading ? (
                <Spinner />
              ) : topics.length === 0 ? (
                <EmptyState
                  title="This course has no topics"
                  body="Add topics or sync them from the approved outline first."
                />
              ) : (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 flex w-full items-center justify-between text-[13px] font-medium">
                    Topics ({selected.length} selected)
                    <span className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(topics.map((t) => t.id))}
                      >
                        Select all
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                        Clear
                      </Button>
                    </span>
                  </legend>
                  {topics.map((t, i) => (
                    <div key={t.id}>
                      <Checkbox
                        label={`${i + 1}. ${t.title}`}
                        checked={selected.includes(t.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, t.id]
                              : selected.filter((x) => x !== t.id),
                          )
                        }
                      />
                      {t.subtopics.length > 0 && (
                        <p className="ml-6 text-[12px] text-muted">
                          Covers: {t.subtopics.map((s) => s.title).join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </fieldset>
              ))}
          </div>
        </Card>
        <Card>
          <CardHeader title={batch ? '3. Progress' : '2. Choose outputs'} />
          <div className="px-5 py-4">
            {batch ? (
              <div className="flex flex-col gap-4">
                <JobProgress batch={batch} topicTitle={titleOf} />
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={() => setBatch(null)}>
                    Generate more
                  </Button>
                </div>
              </div>
            ) : courseId && selected.length ? (
              <GenerateForm courseId={courseId} topicIds={selected} onStarted={setBatch} />
            ) : (
              <p className="py-6 text-center text-sm text-muted">
                Select a course and at least one topic.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

export default function StudioPage() {
  return (
    <RequireInstitution>{(i) => <Studio key={i.id} institutionId={i.id} />}</RequireInstitution>
  );
}
