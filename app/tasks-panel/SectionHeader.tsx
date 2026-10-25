import type { ReactNode } from 'react';

interface SectionHeaderProps {
  label: string;
  count?: number;
  action?: ReactNode;
}

/** 任务面板左栏三区统一的区头：label 左、计数与操作右 */
export function SectionHeader({ label, count, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 text-[11px] font-semibold tracking-wider text-muted-foreground">
      <span>{label}</span>
      {count !== undefined && <span className="text-[10px] opacity-70 tabular-nums">{count}</span>}
      {action && <span className="ml-auto flex items-center">{action}</span>}
    </div>
  );
}
