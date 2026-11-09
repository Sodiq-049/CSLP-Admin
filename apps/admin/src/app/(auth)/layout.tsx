export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <div
          className="grid size-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg"
          aria-hidden
        >
          CS
        </div>
        <div className="leading-tight">
          <div className="font-semibold">CSLP Admin</div>
          <div className="text-[12px] text-muted">Academic content portal</div>
        </div>
      </div>
      <main className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-md sm:p-7">
        {children}
      </main>
      <p className="mt-6 text-[12px] text-subtle">Authorised staff only. Activity is logged.</p>
    </div>
  );
}
