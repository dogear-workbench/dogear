import { useState } from 'react';
import { ChevronRight, FileText, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationUsage } from '@/types/usage';
import { aggregateReadActivity } from './usage-utils';

const DEFAULT_VISIBLE = 5;

/**
 * 重读文件折叠区：列出本会话被 Read 工具多次命中的文件路径。
 * 触发优化思考：是不是某些文件值得缓存、是不是 compact 之后又重读了同一份内容。
 * count < 2 的文件不显示（只读过一次不算"重读"）。
 */
export function UsageReadActivity({ usage }: { usage: ConversationUsage }) {
  const [expanded, setExpanded] = useState(false);
  const all = aggregateReadActivity(usage.entries, usage.compactMarkers).filter(i => i.count >= 2);
  if (all.length === 0) return null;

  const visible = expanded ? all : all.slice(0, DEFAULT_VISIBLE);
  const hidden = all.length - visible.length;
  const totalReads = all.reduce((s, i) => s + i.count, 0);

  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-muted-foreground">
          重读文件 · {all.length} 个文件 / {totalReads} 次
        </span>
      </div>
      <div className="space-y-0.5">
        {visible.map(item => (
          <div key={item.file} className="flex items-center gap-1.5">
            <FileText size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate" title={item.file}>{shortPath(item.file)}</span>
            <span className="ml-auto flex items-center gap-1.5 shrink-0 text-muted-foreground tabular-nums">
              <span>{item.count} ×</span>
              {item.lastIntervalEntries !== null && (
                <span title={`最近两次读取间隔 ${item.lastIntervalEntries} 轮`}>
                  Δ{item.lastIntervalEntries}
                </span>
              )}
              {item.crossedCompact && (
                <RotateCcw
                  size={11}
                  className="text-amber-600"
                  aria-label="跨过 compact 压缩事件"
                />
              )}
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

/** 路径缩短：保留最后两段，前面用 … 替代 */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}
