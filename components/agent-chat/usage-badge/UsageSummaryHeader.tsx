import type { ContextInfo } from './usage-utils';

interface Props {
  context: ContextInfo;
}

/** 弹层头部：当前上下文占用（主进程快照）；会话累计移至弹层底部小字 */
export function UsageSummaryHeader({ context }: Props) {
  const used = context.used;
  const limit = context.limit;
  const pct = used !== null && limit > 0 ? Math.round(context.percentage) : null;

  return (
    <div className="p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">上下文{context.label && ` · ${context.label}`}</span>
        {used !== null ? (
          <span className="tabular-nums font-medium">
            {used.toLocaleString()}
            {limit > 0 ? ` / ${limit.toLocaleString()}` : ''}
            {pct !== null && <span className="text-muted-foreground"> ({pct}%)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground">暂无（发送一条消息后刷新）</span>
        )}
      </div>
    </div>
  );
}
