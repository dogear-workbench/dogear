import type { ContextSnapshot } from '@/types/usage';
import { formatTokens } from './usage-utils';

/** SDK 类别英文名 → 中文标签，未命中显示原名 */
const CATEGORY_LABELS: Record<string, string> = {
  'System prompt': '系统提示',
  'Messages': '历史消息',
  'Tools': '工具',
  'MCP tools': 'MCP 工具',
  'Memory files': '记忆文件',
  'Custom agents': '子代理',
  'Free space': '空闲',
  'Reserved': '预留',
  'Autocompact buffer': '压缩缓冲',
};

function label(name: string): string {
  return CATEGORY_LABELS[name] ?? name;
}

/**
 * 上下文构成细分：渲染 SDK getContextUsage 返回的各类别 token 占比。
 * 占比分母用各类别之和，确保 ratio∈[0,1]，不受是否含「空闲」项影响。
 */
export function UsageContextBreakdown({ latestContext }: { latestContext?: ContextSnapshot }) {
  if (!latestContext || latestContext.categories.length === 0) return null;

  const cats = [...latestContext.categories].sort((a, b) => b.tokens - a.tokens);
  const sum = cats.reduce((s, c) => s + c.tokens, 0) || 1;

  return (
    <div className="p-3 space-y-1.5">
      <div className="text-muted-foreground">上下文构成</div>
      <div className="space-y-1">
        {cats.map((c) => {
          const ratio = Math.min(c.tokens / sum, 1);
          return (
            <div key={c.name} className="space-y-0.5">
              <div className="flex justify-between tabular-nums">
                <span>{label(c.name)}</span>
                <span className="text-muted-foreground">
                  {formatTokens(c.tokens)} ({Math.round(ratio * 100)}%)
                </span>
              </div>
              <span className="block relative w-full h-1 rounded-full bg-border overflow-hidden">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground"
                  style={{ width: `${ratio * 100}%` }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
