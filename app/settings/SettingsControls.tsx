import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-9 scroll-mt-4">
      <h3 className="text-sm font-semibold tracking-wide text-muted-foreground mb-2">{title}</h3>
      {children}
    </section>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc ? <p className="text-xs text-muted-foreground mt-0.5">{desc}</p> : null}
      </div>
      <div className="shrink-0 flex items-center gap-3">{children}</div>
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex h-9 items-center justify-center rounded-md bg-muted p-1', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cn(
            'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all',
            value === opt.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
