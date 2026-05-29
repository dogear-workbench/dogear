import type { ConversationUsage } from '@/types/usage';

/** 按模型分组：统计每个模型在多少轮 result 中出现（不显示金额） */
function aggregateModels(usage: ConversationUsage): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const e of usage.entries) {
    for (const model of Object.keys(e.modelUsage ?? {})) {
      map.set(model, (map.get(model) ?? 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function UsageByModel({ usage }: { usage: ConversationUsage }) {
  const models = aggregateModels(usage);
  return (
    <div className="p-3 space-y-1">
      <div className="text-muted-foreground mb-1">按模型</div>
      {models.length === 0 ? (
        <div className="text-muted-foreground">—</div>
      ) : (
        models.map(([name, turns]) => (
          <div key={name} className="flex justify-between gap-2">
            <span className="truncate" title={name}>{name}</span>
            <span className="tabular-nums text-muted-foreground shrink-0">{turns} 轮</span>
          </div>
        ))
      )}
    </div>
  );
}
