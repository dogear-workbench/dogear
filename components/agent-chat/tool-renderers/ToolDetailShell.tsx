import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 工具详情统一外壳
 * 提供分段式布局（输入 / 输出），不重复 CollapsibleBlock 外层的边框/标题
 * 展开后主内容使用正常前景色，仅小标题用 muted，提高深色主题下的可读性
 */
export function ToolDetailShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 text-xs rounded-md border border-border/50 bg-card px-2.5 py-2', className)}>
      {children}
    </div>
  );
}

export function ToolSection({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

/** key-value 定义列表，用于通用 toolInput 展示 */
export function KeyValueList({ data }: { data: Record<string, any> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 items-baseline">
          <dt className="text-muted-foreground font-mono shrink-0">{k}</dt>
          <dd className="text-foreground font-mono break-all whitespace-pre-wrap min-w-0 flex-1">
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 等宽输出框，支持高度限制 + 错误着色 */
export function OutputBox({
  content,
  isError,
  maxHeightClass = 'max-h-80',
}: {
  content: string;
  isError?: boolean;
  maxHeightClass?: string;
}) {
  return (
    <pre
      className={cn(
        'font-mono whitespace-pre-wrap break-all rounded px-2 py-1.5 overflow-auto',
        maxHeightClass,
        isError
          ? 'bg-red-50 text-red-900 border border-red-200/60'
          : 'bg-muted/40 text-foreground',
      )}
    >
      {content}
    </pre>
  );
}
