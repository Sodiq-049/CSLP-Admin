'use client';

import { useMemo } from 'react';
import { useAcademicStructureListCurricula, useInstitutionsTree } from '@cslp/api-client';

/** Programme → level and semester pickers, built from the institution's academic tree. */
export function useAcademicOptions(institutionId: string | undefined) {
  const tree = useInstitutionsTree(institutionId ?? '', { query: { enabled: !!institutionId } });
  const curricula = useAcademicStructureListCurricula(
    institutionId ?? '',
    { pageSize: 100 },
    { query: { enabled: !!institutionId } },
  );
  return useMemo(() => {
    const t = tree.data?.data;
    const programmes = (t?.faculties ?? []).flatMap((f) =>
      f.departments.flatMap((d) =>
        d.programmes.map((p) => ({ ...p, department: d.name, departmentId: d.id })),
      ),
    );
    return {
      loading: tree.isLoading,
      programmes,
      semesters: t?.semesters ?? [],
      curricula: curricula.data?.data ?? [],
      levelsFor: (programmeId: string | undefined) =>
        programmes.find((p) => p.id === programmeId)?.levels ?? [],
      departments: (t?.faculties ?? []).flatMap((f) =>
        f.departments.map((d) => ({ id: d.id, name: d.name })),
      ),
    };
  }, [tree.data, tree.isLoading, curricula.data]);
}
