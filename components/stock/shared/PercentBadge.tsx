import { cn } from '@/lib/utils';

interface PercentBadgeProps {
  value: number;             // 涨跌幅百分比
  className?: string;
  showSign?: boolean;        // 是否显示 +/- 号，默认 true
}

export function PercentBadge({ value, className, showSign = true }: PercentBadgeProps) {
  const isUp = value > 0;
  const isDown = value < 0;
  const sign = showSign && isUp ? '+' : '';

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
        isUp && 'bg-red-500/10 text-red-500',
        isDown && 'bg-green-500/10 text-green-500',
        !isUp && !isDown && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {sign}{value.toFixed(2)}%
    </span>
  );
}
