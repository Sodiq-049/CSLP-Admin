'use client';

import { useState } from 'react';
import {
  academicStructureArchiveProgramme,
  academicStructureCreateProgramme,
  academicStructureUpdateProgramme,
  useAcademicStructureListDepartments,
  useAcademicStructureListProgrammes,
  type Programme,
} from '@cslp/api-client';
import { PROGRAMME_AWARDS } from '@cslp/shared-types';
import { CreateProgrammeSchema, UpdateProgrammeSchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { SelectField, TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/field';
import { useCan } from '@/lib/auth';

const AWARD_LABEL: Record<string, string> = {
  ND: 'National Diploma',
  HND: 'Higher National Diploma',
  BSc: 'BSc',
  PGD: 'PGD',
  other: 'Other',
};

function Programmes({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  const [departmentId, setDepartmentId] = useState('');
  const departments = useAcademicStructureListDepartments(institutionId, { pageSize: 100 });
  const deptOptions = (departments.data?.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.name} (${d.code})`,
  }));
  const deptName = new Map(deptOptions.map((d) => [d.value, d.label]));

  return (
    <EntityManager<Programme>
      singular="Programme"
      canManage={canManage}
      useRows={(p) =>
        useAcademicStructureListProgrammes(institutionId, {
          ...p,
          ...(departmentId ? { departmentId } : {}),
        })
      }
      rowLabel={(p) => p.name}
      toolbar={
        <Select
          aria-label="Filter by department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="w-full sm:w-64"
        >
          <option value="">All departments</option>
          {deptOptions.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
      }
      createBlockedReason={
        departments.isSuccess && deptOptions.length === 0
          ? 'Add a department before creating programmes.'
          : undefined
      }
      columns={[
        {
          key: 'name',
          header: 'Programme',
          cell: (p) => <span className="font-medium">{p.name}</span>,
        },
        { key: 'award', header: 'Award', cell: (p) => <Badge tone="primary">{p.award}</Badge> },
        {
          key: 'code',
          header: 'Code',
          cell: (p) => <code className="text-[12.5px]">{p.code}</code>,
          className: 'hidden sm:table-cell',
        },
        {
          key: 'dept',
          header: 'Department',
          cell: (p) => deptName.get(p.departmentId) ?? '—',
          className: 'hidden lg:table-cell',
        },
        {
          key: 'dur',
          header: 'Levels',
          cell: (p) => p.durationLevels,
          className: 'hidden md:table-cell',
        },
      ]}
      createSchema={CreateProgrammeSchema}
      updateSchema={UpdateProgrammeSchema}
      createDefaults={{
        departmentId: departmentId || undefined,
        name: '',
        award: 'ND',
        code: '',
        durationLevels: 2,
      }}
      toFormValues={(p) => ({
        name: p.name,
        award: p.award,
        code: p.code,
        durationLevels: p.durationLevels,
      })}
      renderForm={(form, mode) => (
        <>
          {mode === 'create' && (
            <SelectField
              form={form}
              name="departmentId"
              label="Department"
              required
              options={deptOptions}
              placeholder="Select a department"
            />
          )}
          <TextField
            form={form}
            name="name"
            label="Name"
            required
            placeholder="National Diploma in Computer Science"
          />
          <SelectField
            form={form}
            name="award"
            label="Award"
            required
            options={PROGRAMME_AWARDS.map((a) => ({ value: a, label: AWARD_LABEL[a] ?? a }))}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField form={form} name="code" label="Code" required placeholder="ND-CS" />
            <TextField
              form={form}
              name="durationLevels"
              label="Number of levels"
              type="number"
              required
            />
          </div>
        </>
      )}
      onCreate={(v) =>
        academicStructureCreateProgramme(institutionId, {
          departmentId: v.departmentId,
          name: v.name,
          award: v.award,
          code: v.code,
          durationLevels: v.durationLevels,
        })
      }
      onUpdate={(p, v) =>
        academicStructureUpdateProgramme(p.id, {
          name: v.name,
          award: v.award,
          code: v.code,
          durationLevels: v.durationLevels,
        })
      }
      onArchive={(p) => academicStructureArchiveProgramme(p.id)}
      emptyHint="Programmes such as ND and HND belong to a department. Their levels (ND 1, ND 2…) are configured on the Academic Levels page."
    />
  );
}

export default function ProgrammesPage() {
  return (
    <StructurePage
      title="Programmes"
      description="Programmes offered by each department, such as National Diploma (ND) and Higher National Diploma (HND)."
    >
      {(i) => <Programmes key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
