import { cn } from '@/lib/utils';

interface StatusPulseProps {
  /** true=蓝色（等待确认）, false=橙色（运行中） */
  isPending: boolean;
  /** sm=Tab(12px), md=列表(16px, 默认) */
  size?: 'sm' | 'md';
  className?: string;
}

const sizeMap = {
  sm: { outer: 'w-3 h-3', pulse: 'w-2 h-2', core: 'w-1.5 h-1.5' },
  md: { outer: 'w-4 h-4', pulse: 'w-2.5 h-2.5', core: 'w-2 h-2' },
};

/**
 * 状态脉冲指示器
 * - 蓝色脉冲：等待用户确认（权限/AskUser）
 * - 橙色脉冲：Agent 正在运行
 */
export function StatusPulse({ isPending, size = 'md', className }: StatusPulseProps) {
  const s = sizeMap[size];
  const color = isPending
    ? { pulse: 'bg-blue-400', core: 'bg-blue-500' }
    : { pulse: 'bg-orange-400', core: 'bg-orange-500' };

  return (
    <span className={cn('relative flex items-center justify-center flex-shrink-0', s.outer, className)}>
      <span className={cn('absolute rounded-full animate-pulse', s.pulse, color.pulse)} />
      <span className={cn('rounded-full', s.core, color.core)} />
    </span>
  );
}
