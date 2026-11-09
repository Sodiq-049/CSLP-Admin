import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from './button';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-surface-2 p-3 text-subtle">
        <Inbox className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-danger-soft p-3 text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-sm text-fg">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-info/30 bg-info-soft text-fg',
    warning: 'border-warning/30 bg-warning-soft text-fg',
    danger: 'border-danger/30 bg-danger-soft text-fg',
    success: 'border-success/30 bg-success-soft text-fg',
  };
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-md border px-3.5 py-2.5 text-[13px] ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
