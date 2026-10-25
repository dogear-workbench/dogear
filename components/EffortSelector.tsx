import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Brain, ChevronRight } from 'lucide-react';
import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import type { EffortLevel } from '@/types/settings';

interface Props {
  value: EffortLevel | null;
  onChange: (v: EffortLevel | null) => void;
  variant?: 'inline' | 'block';
  unsetLabel?: string;
  /** false 时隐藏顶部 unset 项，五档直选（value 缺省显示「关闭」） */
  allowUnset?: boolean;
  disabled?: boolean;
  effectiveValue?: EffortLevel | null;
}

const LEVEL_LABELS: Partial<Record<EffortLevel, string>> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  max: '最高',
};

const LEVELS = Object.keys(LEVEL_LABELS) as EffortLevel[];

export function EffortSelector({
  value,
  onChange,
  variant = 'inline',
  unsetLabel = '跟随预设',
  allowUnset = true,
  disabled,
  effectiveValue,
}: Props) {
  const resolved = allowUnset ? value : (value ?? 'off');
  const showEffective = resolved === null && effectiveValue != null;
  const currentLabel = resolved
    ? (LEVEL_LABELS[resolved] ?? resolved)
    : showEffective
      ? (LEVEL_LABELS[effectiveValue] ?? effectiveValue)
      : unsetLabel;
  const highlight = allowUnset && value === null ? null : resolved;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled} title="执行力度">
        {variant === 'inline' ? (
          <InputGroupButton size="xs" className={cn('gap-1 shrink-0', resolved ? 'text-primary' : '')}>
            <Brain size={14} />
            <span className="text-xs max-w-[72px] truncate">{currentLabel}</span>
            <ChevronRight size={12} className="rotate-90" />
          </InputGroupButton>
        ) : (
          <button
            type="button"
            className="h-9 w-full px-3 text-sm border rounded bg-background flex items-center justify-between gap-1"
          >
            <span className={cn('truncate', resolved ? '' : 'text-muted-foreground')}>{currentLabel}</span>
            <ChevronRight size={14} className="rotate-90 shrink-0" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {allowUnset && (
          <>
            <DropdownMenuItem
              onSelect={() => onChange(null)}
              className={cn(value === null && 'font-semibold bg-accent')}
            >
              {unsetLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {LEVELS.map(level => (
          <DropdownMenuItem
            key={level}
            onSelect={() => onChange(level)}
            className={cn(highlight === level && 'font-semibold bg-accent')}
          >
            {LEVEL_LABELS[level]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
