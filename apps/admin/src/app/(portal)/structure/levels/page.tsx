'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  academicStructureArchiveLevel,
  academicStructureCreateLevel,
  academicStructureUpdateLevel,
  useAcademicStructureListLevels,
  useAcademicStructureListProgrammes,
  type AcademicLevel,
} from '@cslp/api-client';
import { CreateLevelSchema, UpdateLevelSchema } from '@cslp/validation';
import { EntityManager } from '@/components/entity-manager';
import { TextField } from '@/components/form-fields';
import { StructurePage } from '@/components/structure-page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { EmptyState, Spinner } from '@/components/ui/states';
import { useCan } from '@/lib/auth';

function Levels({ institutionId }: { institutionId: string }) {
  const canManage = useCan('academic.manage', institutionId);
  const programmes = useAcademicStructureListProgrammes(institutionId, { pageSize: 100 });
  const options = programmes.data?.data ?? [];
  const [programmeId, setProgrammeId] = useState('');
  useEffect(() => {
    if (!programmeId && options[0]) setProgrammeId(options[0].id);
  }, [options, programmeId]);

  if (programmes.isLoading) return <Spinner />;
  if (!options.length) {
    return (
      <Card>
        <EmptyState
          title="No programmes yet"
          body="Levels belong to a programme. Create a programme first."
          action={
            <Link href="/structure/programmes">
              <Button>Go to programmes</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  const programme = options.find((p) => p.id === programmeId);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Programme" className="max-w-md">
        {(p) => (
          <Select {...p} value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.award})
              </option>
            ))}
          </Select>
        )}
      </Field>
      {programme && (
        <EntityManager<AcademicLevel>
          key={programme.id}
          singular="Level"
          canManage={canManage}
          useRows={(p) => useAcademicStructureListLevels(programme.id, p)}
          rowLabel={(l) => l.name}
          columns={[
            {
              key: 'rank',
              header: 'Order',
              cell: (l) => <span className="tabular-nums text-muted">{l.rank}</span>,
              className: 'w-20',
            },
            {
              key: 'name',
              header: 'Name',
              cell: (l) => <span className="font-medium">{l.name}</span>,
            },
            {
              key: 'code',
              header: 'Code',
              cell: (l) => <code className="text-[12.5px]">{l.code}</code>,
            },
          ]}
          createSchema={CreateLevelSchema}
          updateSchema={UpdateLevelSchema}
          createDefaults={{ name: `${programme.award} `, code: programme.award, rank: 1 }}
          toFormValues={(l) => ({ name: l.name, code: l.code, rank: l.rank })}
          renderForm={(form) => (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField
                form={form}
                name="name"
                label="Name"
                required
                placeholder={`${programme.award} 1`}
              />
              <TextField
                form={form}
                name="code"
                label="Code"
                required
                placeholder={`${programme.award}1`}
              />
              <TextField form={form} name="rank" label="Order" type="number" required />
            </div>
          )}
          onCreate={(v) =>
            academicStructureCreateLevel(programme.id, { name: v.name, code: v.code, rank: v.rank })
          }
          onUpdate={(l, v) =>
            academicStructureUpdateLevel(l.id, { name: v.name, code: v.code, rank: v.rank })
          }
          onArchive={(l) => academicStructureArchiveLevel(l.id)}
          emptyHint={`Add the levels of ${programme.name}, for example ${programme.award} 1 and ${programme.award} 2.`}
        />
      )}
    </div>
  );
}

export default function LevelsPage() {
  return (
    <StructurePage
      title="Academic levels"
      description="Year levels within each programme, such as ND 1, ND 2, HND 1 and HND 2."
    >
      {(i) => <Levels key={i.id} institutionId={i.id} />}
    </StructurePage>
  );
}
