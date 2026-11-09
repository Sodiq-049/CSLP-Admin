'use client';

import { RequireInstitution } from '@/components/shell/require-institution';
import { SourceLibrary } from '@/components/sources/source-library';
import { PageHeader } from '@/components/ui/page-header';

export default function SourcesPage() {
  return (
    <RequireInstitution>
      {(i) => (
        <>
          <PageHeader
            eyebrow={i.shortName}
            title="Source library"
            description="Approved course outlines, lecture notes, licensed excerpts and references. Generated content cites only these."
          />
          <SourceLibrary key={i.id} institutionId={i.id} />
        </>
      )}
    </RequireInstitution>
  );
}
