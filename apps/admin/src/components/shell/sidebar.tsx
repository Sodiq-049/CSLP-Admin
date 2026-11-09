'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/nav';
import { useMe } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { cn } from '@/components/ui/cn';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const me = useMe();
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <div
          className="grid size-8 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-fg"
          aria-hidden
        >
          CS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">CSLP Admin</div>
          <div className="text-[11.5px] text-muted">Academic content portal</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.permission || can(me, i.permission));
          if (!items.length) return null;
          return (
            <div key={group.label} className="mb-4">
              <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active =
                    item.href === '/'
                      ? pathname === '/'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors',
                          active
                            ? 'bg-primary-soft font-medium text-primary'
                            : 'text-muted hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="flex-1 truncate">{item.label}</span>
                        {(item.phase || item.comingSoon) && (
                          <span
                            className="rounded px-1.5 py-px text-[10.5px] font-medium text-subtle ring-1 ring-border"
                            title={
                              item.comingSoon ? 'Coming soon' : `Arrives in phase ${item.phase}`
                            }
                          >
                            {item.comingSoon ? 'Soon' : `P${item.phase}`}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
