'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm, type Resolver } from 'react-hook-form';
import { z } from 'zod';
import type { Course } from '@cslp/api-client';
import { CourseCodeSchema } from '@cslp/validation';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/states';
import { useAcademicOptions } from '@/lib/academic-options';
import { applyFieldErrors, errorMessage } from '@/lib/errors';

const FormSchema = z.object({
  programmeId: z.string().min(1, 'Required'),
  levelId: z.string().min(1, 'Required'),
  semesterId: z.string().min(1, 'Required'),
  curriculumVersionId: z.string(),
  code: CourseCodeSchema,
  title: z.string().trim().min(3).max(200),
  creditUnits: z.number({ message: 'Required' }).int().min(0).max(30),
  description: z.string().max(5000),
  objectives: z.array(z.object({ text: z.string().trim().min(3).max(500) })).max(30),
  prerequisites: z.array(z.object({ text: z.string().trim().min(2).max(300) })).max(20),
  references: z
    .array(
      z.object({
        citation: z.string().trim().min(3).max(500),
        url: z.union([z.literal(''), z.string().url('Enter a full URL, e.g. https://…')]),
      }),
    )
    .max(50),
  isDemoData: z.boolean(),
});
export type CourseFormValues = z.infer<typeof FormSchema>;

export function toPayload(v: CourseFormValues) {
  return {
    levelId: v.levelId,
    semesterId: v.semesterId,
    ...(v.curriculumVersionId ? { curriculumVersionId: v.curriculumVersionId } : {}),
    code: v.code,
    title: v.title,
    creditUnits: v.creditUnits,
    description: v.description,
    objectives: v.objectives,
    prerequisites: v.prerequisites,
    references: v.references.map((r) => ({
      citation: r.citation,
      ...(r.url ? { url: r.url } : {}),
    })),
  };
}

export function CourseForm({
  institutionId,
  course,
  onSubmit,
  submitLabel,
  disabled,
}: {
  institutionId: string;
  course?: Course;
  onSubmit: (v: CourseFormValues) => Promise<unknown>;
  submitLabel: string;
  disabled?: boolean;
}) {
  const opts = useAcademicOptions(institutionId);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(FormSchema) as Resolver<CourseFormValues>,
    defaultValues: course
      ? {
          programmeId: course.programmeId,
          levelId: course.levelId,
          semesterId: course.semesterId,
          curriculumVersionId: course.curriculumVersionId ?? '',
          code: course.code,
          title: course.title,
          creditUnits: course.creditUnits,
          description: course.description,
          objectives: course.objectives.map((o) => ({ text: o.text })),
          prerequisites: course.prerequisites.map((p) => ({ text: p.text })),
          references: course.references.map((r) => ({ citation: r.citation, url: r.url ?? '' })),
          isDemoData: course.isDemoData,
        }
      : {
          programmeId: '',
          levelId: '',
          semesterId: '',
          curriculumVersionId: '',
          code: '',
          title: '',
          description: '',
          objectives: [],
          prerequisites: [],
          references: [],
          isDemoData: false,
        },
  });
  const { register, formState, watch, setValue } = form;
  const e = formState.errors;
  const objectives = useFieldArray({ control: form.control, name: 'objectives' });
  const prerequisites = useFieldArray({ control: form.control, name: 'prerequisites' });
  const references = useFieldArray({ control: form.control, name: 'references' });
  const programmeId = watch('programmeId');
  const levels = opts.levelsFor(programmeId);
  const curricula = opts.curricula.filter((c) => !c.programmeId || c.programmeId === programmeId);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      if (!applyFieldErrors(err, form.setError)) setError(errorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={disabled} className="flex flex-col gap-6">
        {error && <Alert tone="danger">{error}</Alert>}
        <section className="flex flex-col gap-4">
          <h3 className="text-[13px] font-semibold">Placement</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Programme"
              required
              error={e.programmeId?.message}
              hint={course ? 'A course cannot move to another programme.' : undefined}
            >
              {(p) => (
                <Select
                  {...p}
                  {...register('programmeId', { onChange: () => setValue('levelId', '') })}
                  disabled={!!course || disabled}
                >
                  <option value="">{opts.loading ? 'Loading…' : 'Select a programme'}</option>
                  {opts.programmes.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name} ({pr.award}) · {pr.department}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Level" required error={e.levelId?.message}>
              {(p) => (
                <Select {...p} {...register('levelId')} disabled={!programmeId || disabled}>
                  <option value="">
                    {programmeId && !levels.length ? 'No levels: add them first' : 'Select a level'}
                  </option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Semester" required error={e.semesterId?.message}>
              {(p) => (
                <Select {...p} {...register('semesterId')}>
                  <option value="">Select a semester</option>
                  {opts.semesters.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Curriculum version"
              error={e.curriculumVersionId?.message}
              hint="Optional. The curriculum edition this course follows."
            >
              {(p) => (
                <Select {...p} {...register('curriculumVersionId')}>
                  <option value="">Not specified</option>
                  {curricula.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.effectiveFromSession})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-[13px] font-semibold">Course details</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[10rem_1fr_8rem]">
            <Field label="Course code" required error={e.code?.message} hint="e.g. COM 101">
              {(p) => <Input {...p} {...register('code')} />}
            </Field>
            <Field label="Course title" required error={e.title?.message}>
              {(p) => <Input {...p} {...register('title')} />}
            </Field>
            <Field label="Credit units" required error={e.creditUnits?.message}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={30}
                  {...register('creditUnits', { valueAsNumber: true })}
                />
              )}
            </Field>
          </div>
          <Field label="Description" error={e.description?.message}>
            {(p) => <Textarea {...p} rows={4} {...register('description')} />}
          </Field>
          {!course && (
            <Checkbox
              label="This is demonstration data (not an official course record)"
              {...register('isDemoData')}
            />
          )}
        </section>

        <ListSection
          title="Course objectives"
          hint="Copy these exactly from the official outline. AI tools never change them."
          onAdd={() => objectives.append({ text: '' })}
          addLabel="Add objective"
          empty="No objectives yet."
          count={objectives.fields.length}
        >
          {objectives.fields.map((f, i) => (
            <Row
              key={f.id}
              onRemove={() => objectives.remove(i)}
              label={`Remove objective ${i + 1}`}
            >
              <Field
                label={`Objective ${i + 1}`}
                error={e.objectives?.[i]?.text?.message}
                className="flex-1"
              >
                {(p) => <Input {...p} {...register(`objectives.${i}.text`)} />}
              </Field>
            </Row>
          ))}
        </ListSection>

        <ListSection
          title="Prerequisites"
          onAdd={() => prerequisites.append({ text: '' })}
          addLabel="Add prerequisite"
          empty="No prerequisites."
          count={prerequisites.fields.length}
        >
          {prerequisites.fields.map((f, i) => (
            <Row
              key={f.id}
              onRemove={() => prerequisites.remove(i)}
              label={`Remove prerequisite ${i + 1}`}
            >
              <Field
                label={`Prerequisite ${i + 1}`}
                error={e.prerequisites?.[i]?.text?.message}
                className="flex-1"
              >
                {(p) => (
                  <Input
                    {...p}
                    placeholder="e.g. COM 001 or 'Basic mathematics'"
                    {...register(`prerequisites.${i}.text`)}
                  />
                )}
              </Field>
            </Row>
          ))}
        </ListSection>

        <ListSection
          title="Recommended references"
          onAdd={() => references.append({ citation: '', url: '' })}
          addLabel="Add reference"
          empty="No references."
          count={references.fields.length}
        >
          {references.fields.map((f, i) => (
            <Row
              key={f.id}
              onRemove={() => references.remove(i)}
              label={`Remove reference ${i + 1}`}
            >
              <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
                <Field label={`Reference ${i + 1}`} error={e.references?.[i]?.citation?.message}>
                  {(p) => (
                    <Input
                      {...p}
                      placeholder="Author (Year). Title. Publisher."
                      {...register(`references.${i}.citation`)}
                    />
                  )}
                </Field>
                <Field label="Link" error={e.references?.[i]?.url?.message}>
                  {(p) => (
                    <Input {...p} placeholder="https://…" {...register(`references.${i}.url`)} />
                  )}
                </Field>
              </div>
            </Row>
          ))}
        </ListSection>

        {!disabled && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button
              type="submit"
              loading={formState.isSubmitting}
              disabled={!!course && !formState.isDirty}
            >
              {submitLabel}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

function ListSection({
  title,
  hint,
  children,
  onAdd,
  addLabel,
  empty,
  count,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  onAdd: () => void;
  addLabel: string;
  empty: string;
  count: number;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={onAdd}>
          <Plus className="size-3.5" aria-hidden /> {addLabel}
        </Button>
      </div>
      {count === 0 ? (
        <p className="text-[13px] text-subtle">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">{children}</div>
      )}
    </section>
  );
}

function Row({
  children,
  onRemove,
  label,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  label: string;
}) {
  return (
    <div className="flex items-end gap-2">
      {children}
      <Button variant="ghost" size="sm" onClick={onRemove} aria-label={label} className="mb-0.5">
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
