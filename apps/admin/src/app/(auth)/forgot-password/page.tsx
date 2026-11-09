'use client';

import Link from 'next/link';
import { useState } from 'react';
import { accountForgot } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await accountForgot({ email });
      setSent(r.data.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Reset your password</h1>
        <p className="mt-1 text-[13px] text-muted">
          Enter your account email and we’ll send you a link to choose a new password.
        </p>
      </div>
      {sent ? (
        <Alert tone="success">{sent}</Alert>
      ) : (
        <>
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
          <Button type="submit" loading={busy}>
            Send reset link
          </Button>
        </>
      )}
      <Link href="/login" className="text-center text-[13px] text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
