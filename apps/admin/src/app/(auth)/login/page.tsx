'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { authLogin, authVerifyMfa } from '@cslp/api-client';
import { MfaEnrolment } from '@/components/mfa-enrolment';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

type Step =
  { kind: 'credentials' } | { kind: 'mfa'; mfaToken: string } | { kind: 'enrol'; mfaToken: string };

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = () => {
    qc.clear();
    router.replace(safeNext(params.get('next')));
  };

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await authLogin({ email, password });
      if (r.data.status === 'authenticated') return finish();
      setPassword('');
      setStep(
        r.data.status === 'mfa_required'
          ? { kind: 'mfa', mfaToken: r.data.mfaToken }
          : { kind: 'enrol', mfaToken: r.data.mfaToken },
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'mfa') return;
    setBusy(true);
    setError(null);
    try {
      await authVerifyMfa({ mfaToken: step.mfaToken, code: code.trim() });
      finish();
    } catch (err) {
      setError(errorMessage(err));
      if (/sign in again/i.test(errorMessage(err))) setStep({ kind: 'credentials' });
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'enrol') {
    return (
      <>
        <h1 className="text-lg font-semibold">Set up two-step verification</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted">
          Your role requires an authenticator app before you can use the portal.
        </p>
        <MfaEnrolment mfaToken={step.mfaToken} onDone={finish} />
      </>
    );
  }

  if (step.kind === 'mfa') {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Two-step verification</h1>
          <p className="mt-1 text-[13px] text-muted">
            {useRecovery
              ? 'Enter one of your recovery codes.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={useRecovery ? 'Recovery code' : 'Authentication code'} required>
          {(p) => (
            <Input
              {...p}
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              maxLength={useRecovery ? 11 : 6}
              value={code}
              onChange={(e) =>
                setCode(
                  useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''),
                )
              }
            />
          )}
        </Field>
        <Button
          type="submit"
          loading={busy}
          disabled={useRecovery ? code.length < 10 : code.length !== 6}
        >
          Verify
        </Button>
        <button
          type="button"
          className="text-[13px] text-primary hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode('');
          }}
        >
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCredentials} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-[13px] text-muted">
          Use the email address your invitation was sent to.
        </p>
      </div>
      {params.get('invited') && (
        <Alert tone="success">Your account is ready. Sign in to continue.</Alert>
      )}
      {params.get('reset') && (
        <Alert tone="success">Your password has been changed. Sign in with the new one.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Email" required>
        {(p) => (
          <Input
            {...p}
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Password" required>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </Field>
      <Button type="submit" loading={busy}>
        Sign in
      </Button>
      <Link
        href="/forgot-password"
        className="text-center text-[13px] text-primary hover:underline"
      >
        Forgot your password?
      </Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
