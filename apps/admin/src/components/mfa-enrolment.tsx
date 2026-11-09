'use client';

import { Copy, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { authConfirm, authEnrol } from '@cslp/api-client';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Alert, Spinner } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

/**
 * TOTP enrolment: QR + manual secret → confirm code → show recovery codes once.
 * `mfaToken` is set during first sign-in; omitted when enrolling from Settings.
 */
export function MfaEnrolment({ mfaToken, onDone }: { mfaToken?: string; onDone: () => void }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authEnrol(mfaToken ? { mfaToken } : {})
      .then(async (r) => {
        const qr = await QRCode.toDataURL(r.data.otpauthUrl, { margin: 1, width: 192 });
        if (!cancelled) setSetup({ qr, secret: r.data.secret });
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [mfaToken]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await authConfirm({ code: code.trim(), ...(mfaToken ? { mfaToken } : {}) });
      setRecovery(r.data.recoveryCodes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (recovery) {
    const text = recovery.join('\n');
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="warning">
          Save these recovery codes somewhere safe. Each one works once if you lose access to your
          authenticator. They won’t be shown again.
        </Alert>
        <ul
          className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-2 p-3 font-mono text-[13px]"
          aria-label="Recovery codes"
        >
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigator.clipboard?.writeText(text)}
          >
            <Copy className="size-3.5" aria-hidden /> Copy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([`CSLP Admin recovery codes\n\n${text}\n`], { type: 'text/plain' }),
              );
              const a = Object.assign(document.createElement('a'), {
                href: url,
                download: 'cslp-recovery-codes.txt',
              });
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="size-3.5" aria-hidden /> Download
          </Button>
        </div>
        <Checkbox
          label="I have saved my recovery codes"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <Button disabled={!saved} onClick={onDone}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {!setup && !error && <Spinner label="Preparing authenticator setup" />}
      {setup && (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
            <li>
              Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).
            </li>
            <li>Scan the QR code, or enter the setup key manually.</li>
            <li>Enter the 6-digit code it shows.</li>
          </ol>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              width={160}
              height={160}
              className="rounded-md border border-border bg-white p-1"
            />
            <div className="min-w-0 text-[13px]">
              <div className="text-muted">Setup key</div>
              <code className="mt-1 block rounded bg-surface-2 px-2 py-1.5 font-mono text-[12.5px] break-all">
                {setup.secret}
              </code>
            </div>
          </div>
          <form onSubmit={confirm} className="flex flex-col gap-3">
            <Field label="6-digit code" required>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              )}
            </Field>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Verify and enable
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
