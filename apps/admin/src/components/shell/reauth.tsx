'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { authReauthenticate } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { errorMessage, hasCode } from '@/lib/errors';
import { useMe } from '@/lib/auth';

type Run = <T>(action: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Run>((a) => a());

/**
 * Sensitive actions (role changes, invitations, suspensions) need a sign-in within the last
 * 10 minutes (docs/03 §5). `withRecentAuth(fn)` runs fn; on RECENT_AUTH_REQUIRED it asks for the
 * password (+ MFA code), re-authenticates, then retries fn once.
 */
export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = () =>
    new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject };
      setPassword('');
      setCode('');
      setError(null);
      setOpen(true);
    });

  const run: Run = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (!hasCode(err, 'RECENT_AUTH_REQUIRED')) throw err;
      await ask();
      return action();
    }
  }, []);

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new Error('Re-authentication cancelled'));
    pending.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authReauthenticate({ password, ...(me.mfaEnabled ? { code } : {}) });
      setOpen(false);
      pending.current?.resolve();
      pending.current = null;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Ctx.Provider value={run}>
      {children}
      <Dialog
        open={open}
        onClose={cancel}
        title="Confirm it’s you"
        description="This action changes access to the portal. Please confirm your identity."
        size="sm"
        dismissible={!busy}
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Password" required>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          {me.mfaEnabled && (
            <Field label="Authenticator code" required>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={11}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Confirm
            </Button>
          </div>
        </form>
      </Dialog>
    </Ctx.Provider>
  );
}

export const useRecentAuth = () => useContext(Ctx);
