import { cn } from '@/lib/utils';

interface PriceTextProps {
  value: number;
  prevClose?: number;        // 昨收，用于判断涨跌
  className?: string;
  prefix?: string;           // 前缀如 "¥"
  decimals?: number;         // 小数位数，默认 2
}

export function PriceText({ value, prevClose, className, prefix = '', decimals = 2 }: PriceTextProps) {
  const safeValue = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  const safePrev = typeof prevClose === 'number' && !Number.isNaN(prevClose) ? prevClose : undefined;
  const diff = safePrev !== undefined ? safeValue - safePrev : safeValue;
  const colorClass = diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-500' : 'text-muted-foreground';

  return (
    <span className={cn(colorClass, className)}>
      {prefix}{safeValue.toFixed(decimals)}
    </span>
  );
}
