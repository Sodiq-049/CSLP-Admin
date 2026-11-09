'use client';

import Link from 'next/link';
import type { Institution } from '@cslp/api-client';
import { useInstitution } from '@/lib/institution';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner } from '@/components/ui/states';
import { useCan } from '@/lib/auth';

/** Renders children with the current institution, or a helpful empty state. */
export function RequireInstitution({
  children,
}: {
  children: (institution: Institution) => React.ReactNode;
}) {
  const { current, loading, institutions } = useInstitution();
  const canCreate = useCan('institution.create');
  if (loading) return <Spinner />;
  if (!current || !institutions.length) {
    return (
      <Card>
        <EmptyState
          title="No institution selected"
          body={
            canCreate
              ? 'Create an institution first, then set up its academic structure.'
              : 'You have not been assigned to an institution yet. Ask a Super Administrator for access.'
          }
          action={
            canCreate ? (
              <Link href="/institutions">
                <Button>Go to institutions</Button>
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }
  return <>{children(current)}</>;
}
