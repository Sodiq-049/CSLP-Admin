'use client';

import { useState } from 'react';
import {
  useCoursesList,
  useQuizzesList,
  type Question,
  type QuizzesListParams,
} from '@cslp/api-client';
import { QUESTION_TYPES } from '@cslp/shared-types';
import { QuestionDialog, QuestionStatusBadge, TYPE_LABEL } from '@/components/content/question-ui';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { DataTable, Pagination, SearchInput, type Column } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';

function QuizManagement({ institutionId }: { institutionId: string }) {
  const courses = useCoursesList({ institutionId, pageSize: 100 });
  const [courseId, setCourseId] = useState('');
  const [status, setStatus] = useState<'' | 'draft' | 'approved' | 'rejected'>('draft');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Question | null>(null);
  const params: QuizzesListParams = {
    institutionId,
    page,
    pageSize: 25,
    ...(courseId ? { courseId } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type: type as QuizzesListParams['type'] } : {}),
    ...(q ? { q } : {}),
  };
  const list = useQuizzesList(params);
  const reset = () => setPage(1);

  const columns: Column<Question>[] = [
    {
      key: 'stem',
      header: 'Question',
      cell: (x) => (
        <button onClick={() => setOpen(x)} className="group block text-left">
          <span className="line-clamp-2 font-medium text-fg group-hover:text-primary group-hover:underline">
            {x.stem}
          </span>
          <span className="block text-[12.5px] text-muted">
            {x.topicTitle} · {TYPE_LABEL[x.type]} · {x.difficulty}
            {x.revision > 1 ? ` · rev ${x.revision}` : ''}
          </span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-56',
      cell: (x) => <QuestionStatusBadge q={x} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Quiz management"
        description="Review AI-generated questions before they can be used. Approved questions are composed into quizzes from each topic page."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              reset();
            }}
            placeholder="Search questions"
          />
          <Select
            aria-label="Course"
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              reset();
            }}
            className="w-full sm:w-60"
          >
            <option value="">All courses</option>
            {courses.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              reset();
            }}
            className="w-full sm:w-40"
          >
            <option value="">Any status</option>
            <option value="draft">Needs review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Select
            aria-label="Type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              reset();
            }}
            className="w-full sm:w-44"
          >
            <option value="">All types</option>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          caption="Questions"
          columns={columns}
          rows={list.data?.data}
          rowKey={(x) => x.id}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => list.refetch()}
          empty={
            <EmptyState
              title="No questions here"
              body="Generate questions from approved notes (open the notes and choose “Generate questions”)."
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
      <QuestionDialog question={open} onClose={() => setOpen(null)} />
    </>
  );
}

export default function QuizzesPage() {
  return (
    <RequireInstitution>
      {(i) => <QuizManagement key={i.id} institutionId={i.id} />}
    </RequireInstitution>
  );
}
