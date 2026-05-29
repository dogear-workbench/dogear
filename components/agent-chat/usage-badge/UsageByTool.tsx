import { useState } from 'react';
import type { ConversationUsage } from '@/types/usage';

/** 按工具调用分组：跨所有轮次累加同名工具次数 */
function aggregateTools(usage: ConversationUsage): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const e of usage.entries) {
    for (const t of e.toolCalls ?? []) {
      map.set(t.name, (map.get(t.name) ?? 0) + t.count);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function UsageByTool({ usage }: { usage: ConversationUsage }) {
  const [expanded, setExpanded] = useState(false);
  const tools = aggregateTools(usage);
  const visible = expanded ? tools : tools.slice(0, 5);
  const hidden = tools.length - visible.length;

  return (
    <div className="p-3 space-y-1">
      <div className="text-muted-foreground mb-1">按工具调用</div>
      {tools.length === 0 ? (
        <div className="text-muted-foreground">—</div>
      ) : (
        <>
          {visible.map(([name, count]) => (
            <div key={name} className="flex justify-between gap-2">
              <span className="truncate" title={name}>{name}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{count} ×</span>
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              （+{hidden} 个，展开）
            </button>
          )}
        </>
      )}
    </div>
  );
}
