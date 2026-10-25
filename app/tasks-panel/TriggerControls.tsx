import { cn } from '@/lib/utils';
import { WEEKDAY_CHIPS } from './utils';

export const inputCls =
  'h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

export const MONTH_GRID: (number | 'last')[] = [...Array.from({ length: 31 }, (_, i) => i + 1), 'last'];

export function sameWeekdays(a: number[] | undefined, b: number[]): boolean {
  if (!a || a.length !== b.length) return false;
  const sorted = [...a].sort((x, y) => x - y);
  return sorted.every((v, i) => v === b[i]);
}

export function WeekdayChips({ value, onChange }: { value: number[] | undefined; onChange: (v: number[] | undefined) => void }) {
  const selected = value ?? [0, 1, 2, 3, 4, 5, 6];
  const toggle = (d: number) => {
    let next: number[];
    if (selected.includes(d)) {
      if (selected.length <= 1) return;
      next = selected.filter((x) => x !== d);
    } else {
      next = [...selected, d].sort((a, b) => a - b);
    }
    onChange(next.length === 7 ? undefined : next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {WEEKDAY_CHIPS.map((chip) => (
        <button
          key={chip.value}
          type="button"
          className={cn(
            'h-6 w-6 rounded-full border text-xs transition-colors',
            selected.includes(chip.value)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => toggle(chip.value)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

export interface PresetOption {
  label: string;
  active: boolean;
  onClick: () => void;
}

export function PresetChips({ options }: { options: PresetOption[] }) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          className={cn(
            'h-6 rounded-full border px-2 text-xs transition-colors',
            opt.active
              ? 'border-primary bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={opt.onClick}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
