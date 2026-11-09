'use client';

import {
  academicStructureCreateCurriculum,
  academicStructureUpdateCurriculum,
  useAcademicStructureListCurricula,
  useAcademicStructureListProgrammes,
  type CurriculumVersion,
} from '@cslp/api-client';
import { CreateCurriculumVersionSchema, UpdateCurriculumVersionSchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { CheckboxField, SelectField, TextAreaField, TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { Badge } from '@/components/ui/badge';
import { useCan } from '@/lib/auth';

function Curricula({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  const programmes = useAcademicStructureListProgrammes(institutionId, { pageSize: 100 });
  const options = (programmes.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const programmeName = new Map(options.map((o) => [o.value, o.label]));

  return (
    <EntityManager<CurriculumVersion>
      singular="Curriculum version"
      canManage={canManage}
      archivable={false}
      useRows={(p) => useAcademicStructureListCurricula(institutionId, p)}
      rowLabel={(c) => c.label}
      columns={[
        {
          key: 'label',
          header: 'Curriculum',
          cell: (c) => (
            <span className="inline-flex items-center gap-2 font-medium">
              {c.label} {c.isCurrent && <Badge tone="success">Current</Badge>}
            </span>
          ),
        },
        { key: 'session', header: 'Effective from', cell: (c) => c.effectiveFromSession },
        {
          key: 'programme',
          header: 'Applies to',
          cell: (c) =>
            c.programmeId ? (programmeName.get(c.programmeId) ?? '—') : 'All programmes',
          className: 'hidden md:table-cell',
        },
      ]}
      createSchema={CreateCurriculumVersionSchema}
      updateSchema={UpdateCurriculumVersionSchema}
      createDefaults={{
        label: '',
        effectiveFromSession: '',
        isCurrent: false,
        programmeId: undefined,
        notes: '',
      }}
      toFormValues={(c) => ({
        label: c.label,
        effectiveFromSession: c.effectiveFromSession,
        isCurrent: c.isCurrent,
        notes: c.notes ?? '',
      })}
      renderForm={(form, mode) => (
        <>
          <TextField
            form={form}
            name="label"
            label="Label"
            required
            placeholder="2024 curriculum"
          />
          <TextField
            form={form}
            name="effectiveFromSession"
            label="Effective from session"
            required
            placeholder="2024/2025"
          />
          {mode === 'create' && (
            <SelectField
              form={form}
              name="programmeId"
              label="Programme"
              options={options}
              placeholder="All programmes"
              hint="Leave empty if it applies institution-wide."
            />
          )}
          <TextAreaField
            form={form}
            name="notes"
            label="Notes"
            hint="Source of the curriculum, approving body, etc."
          />
          <CheckboxField form={form} name="isCurrent" label="This is the current curriculum" />
        </>
      )}
      onCreate={(v) =>
        academicStructureCreateCurriculum(institutionId, {
          label: v.label,
          effectiveFromSession: v.effectiveFromSession,
          isCurrent: !!v.isCurrent,
          ...(v.programmeId ? { programmeId: v.programmeId } : {}),
          ...(v.notes ? { notes: v.notes } : {}),
        })
      }
      onUpdate={(c, v) =>
        academicStructureUpdateCurriculum(c.id, {
          label: v.label,
          effectiveFromSession: v.effectiveFromSession,
          isCurrent: !!v.isCurrent,
          ...(v.notes ? { notes: v.notes } : {}),
        })
      }
      emptyHint="Track curriculum editions so courses can be tied to the version they follow. Only one version can be current per programme."
    />
  );
}

export default function CurriculaPage() {
  return (
    <StructurePage
      title="Curricula"
      description="Curriculum editions. Courses reference the version they follow, so history is never overwritten."
    >
      {(i) => <Curricula key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
