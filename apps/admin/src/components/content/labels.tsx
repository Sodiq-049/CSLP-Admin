import type { ContentVersion, LearningMaterial } from '@cslp/api-client';
import { Badge } from '@/components/ui/badge';

export const KIND_LABEL: Record<string, string> = {
  notes_comprehensive: 'Comprehensive notes',
  notes_simplified: 'Simplified notes',
  revision_pack: 'Revision pack',
  quiz: 'Quiz',
  video: 'Video',
  resource: 'Resource',
};

export function DisplayStatusBadge({ status }: { status: LearningMaterial['displayStatus'] }) {
  const map: Record<string, React.ReactNode> = {
    generating: <Badge tone="info">Generating…</Badge>,
    failed: <Badge tone="danger">Generation failed</Badge>,
    draft: <Badge>Draft</Badge>,
    in_review: <Badge tone="warning">In review</Badge>,
    changes_requested: <Badge tone="warning">Changes requested</Badge>,
    rejected: <Badge tone="danger">Rejected</Badge>,
    approved: <Badge tone="success">Approved</Badge>,
    published: (
      <Badge tone="success" dot>
        Published
      </Badge>
    ),
    published_with_draft: (
      <Badge tone="success" dot>
        Published · draft pending
      </Badge>
    ),
    scheduled: <Badge tone="violet">Scheduled</Badge>,
    unpublished: <Badge>Unpublished</Badge>,
    archived: <Badge>Archived</Badge>,
  };
  return <>{map[status] ?? <Badge>{status}</Badge>}</>;
}

export function VersionStatusBadge({
  v,
}: {
  v: Pick<ContentVersion, 'generationStatus' | 'reviewStatus'>;
}) {
  if (v.generationStatus === 'queued' || v.generationStatus === 'generating')
    return <DisplayStatusBadge status="generating" />;
  if (v.generationStatus === 'failed') return <DisplayStatusBadge status="failed" />;
  return <DisplayStatusBadge status={v.reviewStatus} />;
}
