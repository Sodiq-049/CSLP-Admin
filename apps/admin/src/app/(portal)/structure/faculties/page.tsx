'use client';

import {
  academicStructureArchiveFaculty,
  academicStructureCreateFaculty,
  academicStructureUpdateFaculty,
  useAcademicStructureListFaculties,
  type Faculty,
} from '@cslp/api-client';
import { CreateFacultySchema, UpdateFacultySchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { useCan } from '@/lib/auth';

function Faculties({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  return (
    <EntityManager<Faculty>
      singular="Faculty"
      canManage={canManage}
      useRows={(p) => useAcademicStructureListFaculties(institutionId, p)}
      rowLabel={(f) => f.name}
      columns={[
        { key: 'name', header: 'Name', cell: (f) => <span className="font-medium">{f.name}</span> },
        {
          key: 'code',
          header: 'Code',
          cell: (f) => f.code ?? <span className="text-subtle">—</span>,
        },
      ]}
      createSchema={CreateFacultySchema}
      updateSchema={UpdateFacultySchema}
      createDefaults={{ name: '', code: undefined }}
      toFormValues={(f) => ({ name: f.name, code: f.code ?? undefined })}
      renderForm={(form) => (
        <>
          <TextField
            form={form}
            name="name"
            label="Name"
            required
            placeholder="School of Technology"
          />
          <TextField form={form} name="code" label="Code" hint="Optional short code." />
        </>
      )}
      onCreate={(v) =>
        academicStructureCreateFaculty(institutionId, { name: v.name, code: v.code || undefined })
      }
      onUpdate={(f, v) =>
        academicStructureUpdateFaculty(f.id, { name: v.name, code: v.code || undefined })
      }
      onArchive={(f) => academicStructureArchiveFaculty(f.id)}
      emptyHint="Faculties (or schools) group departments. Add the first one to start building the structure."
    />
  );
}

export default function FacultiesPage() {
  return (
    <StructurePage
      title="Faculties"
      description="Faculties or schools: the top level of the academic hierarchy."
    >
      {(i) => <Faculties key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
