'use client';

import { useState } from 'react';
import {
  academicStructureArchiveDepartment,
  academicStructureCreateDepartment,
  academicStructureUpdateDepartment,
  useAcademicStructureListDepartments,
  useAcademicStructureListFaculties,
  type Department,
} from '@cslp/api-client';
import { CreateDepartmentSchema, UpdateDepartmentSchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { SelectField, TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { Select } from '@/components/ui/field';
import { useCan } from '@/lib/auth';

function Departments({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  const [facultyId, setFacultyId] = useState('');
  const faculties = useAcademicStructureListFaculties(institutionId, { pageSize: 100 });
  const facultyOptions = (faculties.data?.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const facultyName = new Map(facultyOptions.map((f) => [f.value, f.label]));

  return (
    <EntityManager<Department>
      singular="Department"
      canManage={canManage}
      useRows={(p) =>
        useAcademicStructureListDepartments(institutionId, {
          ...p,
          ...(facultyId ? { facultyId } : {}),
        })
      }
      rowLabel={(d) => d.name}
      toolbar={
        <Select
          aria-label="Filter by faculty"
          value={facultyId}
          onChange={(e) => setFacultyId(e.target.value)}
          className="w-full sm:w-56"
        >
          <option value="">All faculties</option>
          {facultyOptions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      }
      createBlockedReason={
        faculties.isSuccess && facultyOptions.length === 0
          ? 'Add a faculty before creating departments.'
          : undefined
      }
      columns={[
        { key: 'name', header: 'Name', cell: (d) => <span className="font-medium">{d.name}</span> },
        {
          key: 'code',
          header: 'Code',
          cell: (d) => <code className="text-[12.5px]">{d.code}</code>,
        },
        {
          key: 'faculty',
          header: 'Faculty',
          cell: (d) => facultyName.get(d.facultyId) ?? '—',
          className: 'hidden md:table-cell',
        },
      ]}
      createSchema={CreateDepartmentSchema}
      updateSchema={UpdateDepartmentSchema}
      createDefaults={{ facultyId: facultyId || undefined, name: '', code: '' }}
      toFormValues={(d) => ({ name: d.name, code: d.code })}
      renderForm={(form, mode) => (
        <>
          {mode === 'create' && (
            <SelectField
              form={form}
              name="facultyId"
              label="Faculty"
              required
              options={facultyOptions}
              placeholder="Select a faculty"
            />
          )}
          <TextField form={form} name="name" label="Name" required placeholder="Computer Science" />
          <TextField
            form={form}
            name="code"
            label="Code"
            required
            hint="Unique within the institution, e.g. CSC."
          />
        </>
      )}
      onCreate={(v) =>
        academicStructureCreateDepartment(institutionId, {
          facultyId: v.facultyId,
          name: v.name,
          code: v.code,
        })
      }
      onUpdate={(d, v) => academicStructureUpdateDepartment(d.id, { name: v.name, code: v.code })}
      onArchive={(d) => academicStructureArchiveDepartment(d.id)}
    />
  );
}

export default function DepartmentsPage() {
  return (
    <StructurePage
      title="Departments"
      description="Departments belong to a faculty and offer programmes."
    >
      {(i) => <Departments key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
