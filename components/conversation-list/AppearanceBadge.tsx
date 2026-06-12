import { cn } from '@/lib/utils';

interface AppearanceBadgeProps {
  count: number;
  className?: string;
}

/**
 * ⟂N 角标：count >= 1 时显示，count >= 5 时变橙提示"分类失控"
 * count < 1 时不渲染
 */
export function AppearanceBadge({ count, className }: AppearanceBadgeProps) {
  if (count < 1) return null;
  const orange = count >= 5;
  return (
    <span
      title={`此会话还出现在 ${count} 处`}
      className={cn(
        'inline-flex items-center text-[10px] leading-none px-1 py-0.5 rounded',
        orange
          ? 'text-orange-600 bg-orange-500/10'
          : 'text-muted-foreground bg-muted/40',
        className,
      )}
    >
      ⟂{count}
    </span>
  );
}
