'use client';

import {
  academicStructureArchiveSemester,
  academicStructureCreateSemester,
  academicStructureUpdateSemester,
  useAcademicStructureListSemesters,
  type Semester,
} from '@cslp/api-client';
import { CreateSemesterSchema, UpdateSemesterSchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { useCan } from '@/lib/auth';

function Semesters({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  return (
    <EntityManager<Semester>
      singular="Semester"
      canManage={canManage}
      useRows={(p) => useAcademicStructureListSemesters(institutionId, p)}
      rowLabel={(s) => s.name}
      columns={[
        {
          key: 'rank',
          header: 'Order',
          cell: (s) => <span className="tabular-nums text-muted">{s.rank}</span>,
          className: 'w-20',
        },
        { key: 'name', header: 'Name', cell: (s) => <span className="font-medium">{s.name}</span> },
        {
          key: 'code',
          header: 'Code',
          cell: (s) => <code className="text-[12.5px]">{s.code}</code>,
        },
      ]}
      createSchema={CreateSemesterSchema}
      updateSchema={UpdateSemesterSchema}
      createDefaults={{ name: '', code: '', rank: 1 }}
      toFormValues={(s) => ({ name: s.name, code: s.code, rank: s.rank })}
      renderForm={(form) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField form={form} name="name" label="Name" required placeholder="First Semester" />
          <TextField form={form} name="code" label="Code" required placeholder="S1" />
          <TextField form={form} name="rank" label="Order" type="number" required />
        </div>
      )}
      onCreate={(v) =>
        academicStructureCreateSemester(institutionId, { name: v.name, code: v.code, rank: v.rank })
      }
      onUpdate={(s, v) =>
        academicStructureUpdateSemester(s.id, { name: v.name, code: v.code, rank: v.rank })
      }
      onArchive={(s) => academicStructureArchiveSemester(s.id)}
    />
  );
}

export default function SemestersPage() {
  return (
    <StructurePage
      title="Semesters"
      description="Terms used across the institution. Every course is offered in one semester."
    >
      {(i) => <Semesters key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
