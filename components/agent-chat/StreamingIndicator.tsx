import { Loader2 } from 'lucide-react';

interface StreamingIndicatorProps {
  isLoading: boolean;
  lastBlockType?: string;
}

/** 运行状态指示器：在消息流底部显示当前 Agent 状态 */
export function StreamingIndicator({ isLoading, lastBlockType }: StreamingIndicatorProps) {
  if (!isLoading) return null;

  const label = lastBlockType === 'thinking'
    ? '正在思考...'
    : lastBlockType === 'tool_use'
      ? '正在执行工具...'
      : '正在生成...';

  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground animate-pulse">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
