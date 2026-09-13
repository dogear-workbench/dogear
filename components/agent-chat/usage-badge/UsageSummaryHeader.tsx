import type { ContextInfo } from './usage-utils';
import { formatTokens } from './usage-utils';

interface Props {
  context: ContextInfo;
}

interface CategoryGroup {
  name: string;
  tokens: number;
  children: Array<{ name: string; tokens: number }>;
}

/** 按 `·` 前缀聚合：`提示词·agent.md` 归入主行「提示词」；无 `·` 的 name 自成一主行（未知 name 容错） */
function groupCategories(categories: Array<{ name: string; tokens: number }>): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const c of categories) {
    const sep = c.name.indexOf('·');
    const parent = sep === -1 ? c.name : c.name.slice(0, sep);
    const g = groups.get(parent) ?? { name: parent, tokens: 0, children: [] };
    g.tokens += c.tokens;
    if (sep !== -1) g.children.push({ name: c.name.slice(sep + 1), tokens: c.tokens });
    groups.set(parent, g);
  }
  return [...groups.values()];
}

/** 弹层头部：当前上下文占用（主进程快照）+ 构成明细（估算，旧快照无 categories 不渲染）；会话累计移至弹层底部小字 */
export function UsageSummaryHeader({ context }: Props) {
  const used = context.used;
  const limit = context.limit;
  const pct = used !== null && limit > 0 ? Math.round(context.percentage) : null;
  const groups = context.categories.length > 0 ? groupCategories(context.categories) : [];

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
      {groups.length > 0 && (
        <div className="mt-1.5 space-y-0.5 text-muted-foreground">
          <div className="tabular-nums">
            {groups.map((g) => `${g.name} ${formatTokens(g.tokens)}`).join(' · ')}
            <span>（估算）</span>
          </div>
          {groups
            .filter((g) => g.children.length > 0)
            .map((g) => (
              <div key={g.name} className="tabular-nums pl-3">
                {g.children.map((c) => `${c.name} ${formatTokens(c.tokens)}`).join(' · ')}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
