'use client';

import { createContext, useContext } from 'react';
import type { MeResponse } from '@cslp/api-client';
import type { Permission } from '@cslp/shared-types';
import { can } from './permissions';

const MeContext = createContext<MeResponse | null>(null);

export const MeProvider = MeContext.Provider;

export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside the authenticated portal');
  return me;
}

export function useCan(permission: Permission, institutionId?: string | null): boolean {
  return can(useContext(MeContext) ?? undefined, permission, institutionId);
}
