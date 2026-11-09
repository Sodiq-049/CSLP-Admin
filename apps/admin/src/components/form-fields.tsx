'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';

type F = UseFormReturn<FieldValues>;
const err = (form: F, name: string) => form.formState.errors[name]?.message as string | undefined;

export function TextField({
  form,
  name,
  label,
  required,
  hint,
  placeholder,
  type = 'text',
}: {
  form: F;
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint} error={err(form, name)}>
      {(p) => (
        <Input
          {...p}
          type={type}
          placeholder={placeholder}
          {...form.register(
            name,
            type === 'number'
              ? { valueAsNumber: true }
              : required
                ? undefined
                : { setValueAs: (v: string) => (v === '' ? undefined : v) },
          )}
        />
      )}
    </Field>
  );
}

export function TextAreaField({
  form,
  name,
  label,
  hint,
}: {
  form: F;
  name: string;
  label: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint} error={err(form, name)}>
      {(p) => <Textarea {...p} {...form.register(name)} />}
    </Field>
  );
}

export function SelectField({
  form,
  name,
  label,
  required,
  hint,
  options,
  placeholder,
}: {
  form: F;
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required} hint={hint} error={err(form, name)}>
      {(p) => (
        <Select
          {...p}
          {...form.register(name, { setValueAs: (v: string) => (v === '' ? undefined : v) })}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function CheckboxField({ form, name, label }: { form: F; name: string; label: string }) {
  return <Checkbox label={label} {...form.register(name)} />;
}
