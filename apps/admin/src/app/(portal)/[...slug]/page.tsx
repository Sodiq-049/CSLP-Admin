'use client';

import { Construction } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { findNavItem } from '@/lib/nav';

export default function ComingSoonPage() {
  const item = findNavItem(usePathname());
  if (!item?.phase && !item?.comingSoon) {
    return (
      <Card className="px-6 py-14 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The page you’re looking for doesn’t exist.</p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="secondary">Back to overview</Button>
        </Link>
      </Card>
    );
  }
  return (
    <>
      <PageHeader title={item.label} />
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <div className="mb-4 rounded-full bg-primary-soft p-3 text-primary">
          <Construction className="size-6" aria-hidden />
        </div>
        <h2 className="text-base font-semibold">
          {item.comingSoon ? 'Coming soon' : `Coming in phase ${item.phase}`}
        </h2>
        {item.description && <p className="mt-2 max-w-md text-sm text-muted">{item.description}</p>}
      </Card>
    </>
  );
}
