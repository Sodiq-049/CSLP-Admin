'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { coursesCreate } from '@cslp/api-client';
import { CourseForm, toPayload } from '@/components/courses/course-form';
import { RequireInstitution } from '@/components/shell/require-institution';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { invalidateAdmin } from '@/lib/query';

export default function NewCoursePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <RequireInstitution>
      {(inst) => (
        <>
          <Link
            href="/courses"
            className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Courses
          </Link>
          <PageHeader
            eyebrow={inst.shortName}
            title="New course"
            description="The course is created as a draft. Add its outline and topics next."
          />
          <Card className="px-5 py-5">
            <CourseForm
              key={inst.id}
              institutionId={inst.id}
              submitLabel="Create course"
              onSubmit={async (v) => {
                const r = await coursesCreate({
                  programmeId: v.programmeId,
                  isDemoData: v.isDemoData,
                  ...toPayload(v),
                });
                await invalidateAdmin(qc);
                toast.success(`${r.data.code} created`);
                router.push(`/courses/${r.data.id}?tab=outline`);
              }}
            />
          </Card>
        </>
      )}
    </RequireInstitution>
  );
}
