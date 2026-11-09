'use client';

import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { accountVerify } from '@cslp/api-client';
import { Alert, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

/** Landing page for student email-verification links (the student apps sign in separately). */
function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'done' | 'error'>(token ? 'working' : 'error');
  const [error, setError] = useState('This verification link is incomplete.');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // tokens are single-use: never submit twice (React strict mode)
    accountVerify({ token })
      .then(() => setState('done'))
      .catch((err) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [token]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Verify your email</h1>
      {state === 'working' && <Spinner label="Verifying" />}
      {state === 'done' && (
        <Alert tone="success">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-4" aria-hidden /> Your email is verified.
          </span>{' '}
          You can now sign in to the CSLP student app.
        </Alert>
      )}
      {state === 'error' && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
