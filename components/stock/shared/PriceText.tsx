import { cn } from '@/lib/utils';

interface PriceTextProps {
  value: number;
  prevClose?: number;        // 昨收，用于判断涨跌
  className?: string;
  prefix?: string;           // 前缀如 "¥"
  decimals?: number;         // 小数位数，默认 2
}

export function PriceText({ value, prevClose, className, prefix = '', decimals = 2 }: PriceTextProps) {
  const diff = prevClose !== undefined ? value - prevClose : value;
  const colorClass = diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-500' : 'text-muted-foreground';

  return (
    <span className={cn(colorClass, className)}>
      {prefix}{value.toFixed(decimals)}
    </span>
  );
}
