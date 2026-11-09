'use client';

import type { Institution } from '@cslp/api-client';
import { RequireInstitution } from '@/components/shell/require-institution';
import { PageHeader } from '@/components/ui/page-header';

export function StructurePage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (institution: Institution) => React.ReactNode;
}) {
  return (
    <RequireInstitution>
      {(institution) => (
        <>
          <PageHeader
            eyebrow={`${institution.shortName} · Academic structure`}
            title={title}
            description={description}
          />
          {children(institution)}
        </>
      )}
    </RequireInstitution>
  );
}
