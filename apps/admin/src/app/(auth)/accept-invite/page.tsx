'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { authAcceptInvitation } from '@cslp/api-client';
import { AcceptInvitationRequestSchema } from '@cslp/validation';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { applyFieldErrors, errorMessage } from '@/lib/errors';

const FormSchema = AcceptInvitationRequestSchema.extend({ confirm: z.string() }).refine(
  (v) => v.password === v.confirm,
  {
    path: ['confirm'],
    message: 'Passwords do not match',
  },
);
type FormValues = z.input<typeof FormSchema>;

function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { firstName: '', lastName: '', password: '', confirm: '' },
  });
  const { register, handleSubmit, formState } = form;

  if (!token)
    return (
      <Alert tone="danger">
        This invitation link is incomplete. Open the link from your email again.
      </Alert>
    );

  const onSubmit = handleSubmit(async ({ confirm: _c, ...values }) => {
    setError(null);
    try {
      await authAcceptInvitation(token, values);
      router.replace('/login?invited=1');
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">Accept your invitation</h1>
        <p className="mt-1 text-[13px] text-muted">Set your name and a strong password.</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" required error={formState.errors.firstName?.message}>
          {(p) => <Input {...p} autoComplete="given-name" {...register('firstName')} />}
        </Field>
        <Field label="Last name" required error={formState.errors.lastName?.message}>
          {(p) => <Input {...p} autoComplete="family-name" {...register('lastName')} />}
        </Field>
      </div>
      <Field
        label="Password"
        required
        hint="At least 12 characters, with upper-case, lower-case and a digit."
        error={formState.errors.password?.message}
      >
        {(p) => (
          <Input {...p} type="password" autoComplete="new-password" {...register('password')} />
        )}
      </Field>
      <Field label="Confirm password" required error={formState.errors.confirm?.message}>
        {(p) => (
          <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />
        )}
      </Field>
      <Button type="submit" loading={formState.isSubmitting}>
        Create account
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
