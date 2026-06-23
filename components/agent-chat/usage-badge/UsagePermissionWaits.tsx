import { useState } from 'react';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationUsage } from '@/types/usage';
import { aggregatePermissionWaits, formatWaitMs } from './usage-utils';

const DEFAULT_VISIBLE = 5;

/**
 * 权限等待折叠区：按工具聚合权限请求次数 + 累计/平均等待时长。
 * 帮助识别"哪些工具频繁拦人 → 是不是该加 always_allow / 调权限模式"。
 * 无任何权限等待时整块隐藏。
 */
export function UsagePermissionWaits({ usage }: { usage: ConversationUsage }) {
  const [expanded, setExpanded] = useState(false);
  const all = aggregatePermissionWaits(usage.entries);
  if (all.length === 0) return null;

  const visible = expanded ? all : all.slice(0, DEFAULT_VISIBLE);
  const hidden = all.length - visible.length;
  const totalCount = all.reduce((s, i) => s + i.totalCount, 0);
  const totalWait = all.reduce((s, i) => s + i.totalWaitMs, 0);

  return (
    <div className="p-3 space-y-1">
      <div className="text-muted-foreground mb-1">
        权限等待 · {totalCount} 次 / 累计 {formatWaitMs(totalWait)}
      </div>
      <div className="space-y-0.5">
        {visible.map(item => (
          <div key={item.toolName} className="flex items-center gap-1.5">
            <ShieldAlert size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate" title={item.toolName}>{item.toolName}</span>
            <span className="ml-auto flex items-center gap-2 shrink-0 text-muted-foreground tabular-nums">
              <span>{item.totalCount}×</span>
              <span title={`平均 ${formatWaitMs(item.avgWaitMs)}`}>{formatWaitMs(item.totalWaitMs)}</span>
              <DecisionBadges decisions={item.decisions} />
            </span>
          </div>
        ))}
        {all.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ChevronRight size={12} className={cn('transition-transform', expanded && 'rotate-90')} />
            {expanded ? '收起' : `+${hidden} 个，展开`}
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionBadges({
  decisions,
}: {
  decisions: { allow: number; deny: number; always_allow: number; allow_session: number };
}) {
  const items: Array<[string, number, string]> = [
    ['✓', decisions.allow + decisions.allow_session, '允许 / 本次会话允许'],
    ['★', decisions.always_allow, '始终允许'],
    ['✕', decisions.deny, '拒绝'],
  ];
  return (
    <span className="flex gap-1">
      {items.filter(([, n]) => n > 0).map(([label, n, title]) => (
        <span key={label} title={title} className="text-[10px]">
          {label}{n}
        </span>
      ))}
    </span>
  );
}
