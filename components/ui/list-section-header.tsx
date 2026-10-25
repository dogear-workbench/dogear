import { ChevronDown, ChevronRight, ChevronsDownUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListSectionHeaderProps {
  icon?: LucideIcon;
  iconClassName?: string;
  label: string;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  onCollapse?: () => void;
  className?: string;
}

export function ListSectionHeader({
  icon: Icon,
  iconClassName,
  label,
  count,
  expanded,
  onToggle,
  onCollapse,
  className,
}: ListSectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 py-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors',
        onToggle && 'cursor-pointer select-none',
        className,
      )}
      onClick={onToggle}
    >
      {onToggle && (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
      {Icon && <Icon className={iconClassName ?? 'w-3 h-3'} />}
      <span>{label}</span>
      {count !== undefined && <span className="ml-auto text-[10px] opacity-70 tabular-nums">{count}</span>}
      {expanded && onCollapse && (
        <button
          className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground/70 hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          title="收起"
        >
          <ChevronsDownUp className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
