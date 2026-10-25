import { ListSectionHeader } from '@/components/ui/list-section-header';

interface CollapsibleSectionProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** 折叠分组段（sticky 分组头 + 条数） */
export function CollapsibleSection({ label, count, collapsed, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div>
      <ListSectionHeader
        label={label}
        count={count}
        expanded={!collapsed}
        onToggle={onToggle}
        className="sticky top-0 z-10 bg-muted/40"
      />
      {!collapsed && <div>{children}</div>}
    </div>
  );
}
