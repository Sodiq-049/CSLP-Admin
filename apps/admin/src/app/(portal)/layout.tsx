'use client';

import { useAuthMe } from '@cslp/api-client';
import { PortalShell } from '@/components/shell/portal-shell';
import { ReauthProvider } from '@/components/shell/reauth';
import { Spinner } from '@/components/ui/states';
import { MeProvider } from '@/lib/auth';
import { InstitutionProvider } from '@/lib/institution';

/** Auth gate: everything under (portal) requires a live admin session. 401s redirect via the query cache. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useAuthMe({ query: { retry: false, staleTime: 60_000 } });
  const me = data?.data;
  if (isLoading || !me) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  return (
    <MeProvider value={me}>
      <InstitutionProvider>
        <ReauthProvider>
          <PortalShell>{children}</PortalShell>
        </ReauthProvider>
      </InstitutionProvider>
    </MeProvider>
  );
}
