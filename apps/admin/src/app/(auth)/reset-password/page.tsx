'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { accountReset } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

function ResetForm() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token)
    return (
      <Alert tone="danger">
        This reset link is incomplete. Open the link from your email again, or{' '}
        <Link href="/forgot-password" className="font-medium underline">
          request a new one
        </Link>
        .
      </Alert>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await accountReset({ token, password });
      router.replace('/login?reset=1');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        <p className="mt-1 text-[13px] text-muted">
          Administrators need at least 12 characters with upper-case, lower-case and a digit. You’ll
          be signed out everywhere else.
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="New password" required>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Confirm password" required>
        {(p) => (
          <Input
            {...p}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        )}
      </Field>
      <Button type="submit" loading={busy}>
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
