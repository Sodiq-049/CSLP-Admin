'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError, configureApiClient } from '@cslp/api-client';
import { ToastProvider } from '@/components/ui/toast';
import '@/lib/zod-messages';

configureApiClient({ baseUrl: '' });

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) =>
              !(err instanceof ApiClientError && err.status < 500) && count < 2,
          },
        },
        queryCache: new QueryCache({
          onError: (err) => {
            if (
              err instanceof ApiClientError &&
              (err.code === 'UNAUTHENTICATED' || err.code === 'MFA_REQUIRED')
            ) {
              const next = window.location.pathname + window.location.search;
              if (!window.location.pathname.startsWith('/login'))
                router.replace(`/login?next=${encodeURIComponent(next)}`);
            }
          },
        }),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
