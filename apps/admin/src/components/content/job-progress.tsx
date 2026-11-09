'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSourcesJob, type GenerationBatch } from '@cslp/api-client';
import { KIND_LABEL } from './labels';

function JobRow({ job, topicTitle }: { job: GenerationBatch['jobs'][number]; topicTitle: string }) {
  const q = useSourcesJob(job.jobId, {
    query: {
      refetchInterval: (s) =>
        s.state.data && ['completed', 'failed', 'cancelled'].includes(s.state.data.data.status)
          ? false
          : 1500,
    },
  });
  const j = q.data?.data;
  const done = j?.status === 'completed';
  const failed = j?.status === 'failed';
  return (
    <li className="flex items-center gap-3 px-5 py-3 text-[13px]">
      {done ? (
        <CheckCircle2 className="size-4 text-success" aria-hidden />
      ) : failed ? (
        <XCircle className="size-4 text-danger" aria-hidden />
      ) : (
        <Loader2 className="size-4 animate-spin text-info" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {topicTitle} · {KIND_LABEL[job.kind]}
        </div>
        <div className="text-[12px] text-muted">
          {failed
            ? j?.error
            : done
              ? 'Draft ready for review'
              : `${j?.progress.stage ?? 'queued'}…`}
        </div>
      </div>
      {(done || failed) && (
        <Link href={`/content/versions/${job.versionId}`} className="text-primary hover:underline">
          Open
        </Link>
      )}
    </li>
  );
}

export function JobProgress({
  batch,
  topicTitle,
}: {
  batch: GenerationBatch;
  topicTitle: (id: string) => string;
}) {
  return (
    <ul className="divide-y divide-border" aria-live="polite">
      {batch.jobs.map((j) => (
        <JobRow key={j.jobId} job={j} topicTitle={topicTitle(j.topicId)} />
      ))}
    </ul>
  );
}
