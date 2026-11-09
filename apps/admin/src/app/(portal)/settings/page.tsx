'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { authChangePassword, authRevokeSession, useAuthSessionsList } from '@cslp/api-client';
import { ChangePasswordRequestSchema } from '@cslp/validation';
import { MfaEnrolment } from '@/components/mfa-enrolment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, Spinner } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useMe } from '@/lib/auth';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { fmtDate } from '@/lib/query';

const PasswordForm = ChangePasswordRequestSchema.extend({ confirm: z.string() }).refine(
  (v) => v.newPassword === v.confirm,
  { path: ['confirm'], message: 'Passwords do not match' },
);
type PasswordValues = z.input<typeof PasswordForm>;

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac OS X/.test(ua)
    ? 'macOS'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' on ');
}

export default function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const sessions = useAuthSessionsList();
  const [enrolling, setEnrolling] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(PasswordForm),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const e = form.formState.errors;

  const changePassword = form.handleSubmit(async ({ confirm: _c, ...v }) => {
    setPwError(null);
    try {
      await authChangePassword(v);
      form.reset();
      await sessions.refetch();
      toast.success('Password changed. Other sessions were signed out.');
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setPwError(errorMessage(err));
    }
  });

  return (
    <>
      <PageHeader title="Account & security" description={me.email} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Two-step verification"
            description="An authenticator app code is required at every sign-in."
            actions={
              me.mfaEnabled ? (
                <Badge tone="success">Enabled</Badge>
              ) : (
                <Badge tone="warning">Not enabled</Badge>
              )
            }
          />
          <div className="px-5 py-4 text-sm text-muted">
            {me.mfaEnabled ? (
              'Your account is protected. If you lose your device, sign in with a recovery code and contact a Super Administrator.'
            ) : (
              <div className="flex flex-col items-start gap-3">
                <span>Protect your account with an authenticator app.</span>
                <Button onClick={() => setEnrolling(true)}>Set up two-step verification</Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Change password"
            description="Changing your password signs out all your other sessions."
          />
          <form onSubmit={changePassword} className="flex flex-col gap-4 px-5 py-4" noValidate>
            {pwError && <Alert tone="danger">{pwError}</Alert>}
            <Field label="Current password" required error={e.currentPassword?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  {...form.register('currentPassword')}
                />
              )}
            </Field>
            <Field
              label="New password"
              required
              hint="At least 12 characters, with upper-case, lower-case and a digit."
              error={e.newPassword?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('newPassword')}
                />
              )}
            </Field>
            <Field label="Confirm new password" required error={e.confirm?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirm')}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={form.formState.isSubmitting}>
                Change password
              </Button>
            </div>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Active sessions"
            description="Devices currently signed in to your account."
          />
          {sessions.isLoading ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-border">
              {sessions.data?.data.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <Monitor className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {describeAgent(s.userAgent)}{' '}
                      {s.current && <Badge tone="primary">This device</Badge>}
                    </div>
                    <div className="text-[12.5px] text-muted">
                      {s.ip ?? 'Unknown IP'} · last active {fmtDate(s.lastUsedAt)}
                    </div>
                  </div>
                  {!s.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try {
                          await authRevokeSession(s.id);
                          await sessions.refetch();
                          toast.success('Session signed out');
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog
        open={enrolling}
        onClose={() => setEnrolling(false)}
        title="Set up two-step verification"
        dismissible={false}
      >
        {enrolling && (
          <MfaEnrolment
            onDone={async () => {
              setEnrolling(false);
              await qc.invalidateQueries({ queryKey: ['/api/v1/auth/me'] });
              toast.success('Two-step verification enabled');
            }}
          />
        )}
      </Dialog>
    </>
  );
}
