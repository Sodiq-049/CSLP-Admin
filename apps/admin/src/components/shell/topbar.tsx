'use client';

import { ChevronDown, LogOut, Menu, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authLogout } from '@cslp/api-client';
import { ROLE_LABELS, type Role } from '@cslp/shared-types';
import { useMe } from '@/lib/auth';
import { useInstitution } from '@/lib/institution';
import { Select } from '@/components/ui/field';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const me = useMe();
  const { institutions, current, setCurrentId } = useInstitution();
  const router = useRouter();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !menuRef.current?.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const signOut = async () => {
    await authLogout().catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  const primaryRole = (me.assignments.find((a) => a.role === 'super_admin') ?? me.assignments[0])
    ?.role as Role | undefined;
  const initials =
    `${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase() || me.email[0]!.toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
      <button
        onClick={onMenu}
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor="institution-switcher" className="hidden text-[12.5px] text-muted sm:block">
          Institution
        </label>
        {institutions.length > 0 ? (
          <Select
            id="institution-switcher"
            value={current?.id ?? ''}
            onChange={(e) => setCurrentId(e.target.value)}
            className="h-8 w-[min(16rem,50vw)] text-[13px]"
          >
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.shortName} · {i.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-[13px] text-muted">No institutions yet</span>
        )}
      </div>

      <div className="ml-auto" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 hover:bg-surface-2"
        >
          <span
            className="grid size-7 place-items-center rounded-full bg-primary-soft text-[12px] font-semibold text-primary"
            aria-hidden
          >
            {initials}
          </span>
          <span className="hidden text-left leading-tight md:block">
            <span className="block text-[13px] font-medium">{me.firstName || me.email}</span>
            {primaryRole && (
              <span className="block text-[11.5px] text-muted">{ROLE_LABELS[primaryRole]}</span>
            )}
          </span>
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-4 mt-1.5 w-60 rounded-md border border-border bg-surface p-1 shadow-md"
          >
            <div className="border-b border-border px-2.5 py-2">
              <div className="truncate text-[13px] font-medium">{me.email}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                <ShieldCheck
                  className={me.mfaEnabled ? 'size-3.5 text-success' : 'size-3.5 text-warning'}
                  aria-hidden
                />
                {me.mfaEnabled ? 'MFA enabled' : 'MFA not enabled'}
              </div>
            </div>
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded px-2.5 py-2 text-[13px] hover:bg-surface-2"
            >
              <UserRound className="size-4 text-muted" aria-hidden /> Account & security
            </Link>
            <button
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] text-danger hover:bg-danger-soft"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
