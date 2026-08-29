import { useState } from 'react';
import type { ConversationUsage } from '@/types/usage';

const CHIP_LIMIT = 8;

/** 按工具调用分组：跨所有轮次累加同名工具次数 */
function aggregateTools(usage: ConversationUsage): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const e of usage.entries) {
    for (const t of e.toolActivity?.calls ?? []) {
      map.set(t.name, (map.get(t.name) ?? 0) + t.count);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** 按工具调用汇总（紧凑 chips 流式排布，默认 8 个 + 展开剩余） */
export function UsageByTool({ usage }: { usage: ConversationUsage }) {
  const [expanded, setExpanded] = useState(false);
  const tools = aggregateTools(usage);
  const visible = expanded ? tools : tools.slice(0, CHIP_LIMIT);
  const hidden = tools.length - visible.length;

  if (tools.length === 0) return null;

  return (
    <div className="p-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        <span className="shrink-0">工具</span>
        {visible.map(([name, count]) => (
          <span key={name} className="tabular-nums" title={name}>
            <span className="font-mono">{name}</span> ×{count}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="hover:text-foreground"
          >
            +{hidden}
          </button>
        )}
        {expanded && tools.length > CHIP_LIMIT && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="hover:text-foreground"
          >
            收起
          </button>
        )}
      </div>
    </div>
  );
}
