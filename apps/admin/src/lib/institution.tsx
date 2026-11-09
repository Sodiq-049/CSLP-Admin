'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useInstitutionsList, type Institution } from '@cslp/api-client';

interface InstitutionState {
  institutions: Institution[];
  current: Institution | null;
  setCurrentId: (id: string) => void;
  loading: boolean;
}

const Ctx = createContext<InstitutionState | null>(null);
const STORAGE_KEY = 'cslp.admin.institution';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The institution the admin is currently working in (topbar switcher). */
export function InstitutionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useInstitutionsList({ pageSize: 100 });
  const institutions = useMemo(() => data?.data ?? [], [data]);
  const [currentId, setCurrentIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!institutions.length) return;
    const stored = readStored();
    const valid = institutions.find((i) => i.id === (currentId ?? stored));
    if (!valid) setCurrentIdState(institutions[0]!.id);
    else if (!currentId) setCurrentIdState(valid.id);
  }, [institutions, currentId]);

  const setCurrentId = (id: string) => {
    setCurrentIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable: selection lasts for this tab only */
    }
  };

  const current = institutions.find((i) => i.id === currentId) ?? null;
  return (
    <Ctx.Provider value={{ institutions, current, setCurrentId, loading: isLoading }}>
      {children}
    </Ctx.Provider>
  );
}

export function useInstitution(): InstitutionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInstitution must be used inside InstitutionProvider');
  return v;
}
