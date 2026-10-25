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

/** 旧快照分类名 → 现行名；映射后同名项合并（人格纪律 + agent.md 并入系统提示词） */
const LEGACY_CATEGORY_RENAMES: Record<string, string> = {
  '提示词·人格纪律': '固定·系统提示词',
  '提示词·agent.md': '固定·系统提示词',
  '提示词·skill 索引': '固定·扩展',
  工具定义: '固定·工具定义',
};

function normalizeCategories(categories: Array<{ name: string; tokens: number }>): Array<{ name: string; tokens: number }> {
  const merged = new Map<string, number>();
  for (const c of categories) {
    const name = LEGACY_CATEGORY_RENAMES[c.name] ?? c.name;
    merged.set(name, (merged.get(name) ?? 0) + c.tokens);
  }
  return [...merged].map(([name, tokens]) => ({ name, tokens }));
}

/** 按 `·` 前缀聚合：`固定·系统提示词` 归入主行「固定」；无 `·` 的 name 自成一主行（未知 name 容错） */
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
  const groups = context.categories.length > 0 ? groupCategories(normalizeCategories(context.categories)) : [];

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
          {groups.map((g, i) => (
            <div key={g.name}>
              <div className="tabular-nums">
                {g.name} {formatTokens(g.tokens)}
                {i === 0 && <span>（估算）</span>}
              </div>
              {g.children.length > 0 && (
                <div className="tabular-nums pl-3">
                  {g.children.map((c) => `${c.name} ${formatTokens(c.tokens)}`).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
