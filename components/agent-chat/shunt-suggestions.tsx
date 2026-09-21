import { useMemo } from 'react';
import { Split, MessageSquarePlus, FolderPlus, StickyNote, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer, type MarkdownRendererProps } from '@/components/MarkdownRenderer';

/**
 * 分流建议卡文本协议：agent 在回复末尾输出 fenced JSON 块（语言标签 shunt-suggestions）：
 * ```shunt-suggestions
 * {"summary":"<岔题一句话摘要>","options":["new-session","new-topic","note"]}
 * ```
 */
export const SHUNT_ACTIONS = ['new-session', 'new-topic', 'note'] as const;
export type ShuntAction = (typeof SHUNT_ACTIONS)[number];

export interface ShuntSuggestions {
  summary: string;
  options: ShuntAction[];
}

const SHUNT_BLOCK_RE = /```shunt-suggestions[ \t]*\r?\n([\s\S]*?)```/g;
const SHUNT_UNCLOSED_RE = /(^|\n)[ \t]*```shunt-suggestions[\s\S]*$/;

const SHUNT_ACTION_META: Record<ShuntAction, { label: string; icon: LucideIcon }> = {
  'new-session': { label: '另起会话', icon: MessageSquarePlus },
  'new-topic': { label: '另起话题', icon: FolderPlus },
  note: { label: '记为笔记', icon: StickyNote },
};

interface RawShuntPayload {
  summary?: unknown;
  options?: unknown;
}

function parseShuntPayload(payload: string): ShuntSuggestions | null {
  try {
    const raw = JSON.parse(payload.trim()) as RawShuntPayload;
    const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 120) : '';
    if (!summary) return null;
    const options = Array.isArray(raw.options)
      ? raw.options.filter((o): o is ShuntAction => typeof o === 'string' && (SHUNT_ACTIONS as readonly string[]).includes(o))
      : [];
    const unique = [...new Set(options)] as ShuntAction[];
    if (unique.length === 0) return null;
    return { summary, options: unique };
  } catch {
    return null;
  }
}

/** 剥除 assistant 文本中的建议块并解析卡片数据；未闭合块（流式中途）一并剥除，避免半截 JSON 渲染成代码块 */
export function parseShuntSuggestions(content: string): { body: string; suggestions: ShuntSuggestions | null } {
  let lastPayload: string | null = null;
  const body = content
    .replace(SHUNT_BLOCK_RE, (_match, payload: string) => {
      lastPayload = payload;
      return '';
    })
    .replace(SHUNT_UNCLOSED_RE, '$1');
  return { body, suggestions: lastPayload !== null ? parseShuntPayload(lastPayload) : null };
}

function ShuntSuggestionCard({ suggestions }: { suggestions: ShuntSuggestions }) {
  return (
    <div className="my-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
        <Split size={12} className="flex-shrink-0" />
        <span className="flex-shrink-0">这个话题可以单独处理：</span>
        <span className="text-foreground/80 truncate" title={suggestions.summary}>{suggestions.summary}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.options.map((action) => {
          const meta = SHUNT_ACTION_META[action];
          const Icon = meta.icon;
          return (
            <Button
              key={action}
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => toast.info(`「${meta.label}」即将支持，敬请期待`)}
            >
              <Icon size={12} className="mr-1" />
              {meta.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** assistant 正文渲染入口：先截获分流建议块再交给 MarkdownRenderer，卡片渲染在正文之后 */
export function ShuntAwareMarkdown({
  content,
  className,
  searchQuery,
  matchIdPrefix,
  activeMatchId,
  workspacePath,
}: Pick<MarkdownRendererProps, 'content' | 'className' | 'searchQuery' | 'matchIdPrefix' | 'activeMatchId' | 'workspacePath'>) {
  const { body, suggestions } = useMemo(() => parseShuntSuggestions(content), [content]);
  return (
    <>
      <MarkdownRenderer
        content={body}
        className={className}
        searchQuery={searchQuery}
        matchIdPrefix={matchIdPrefix}
        activeMatchId={activeMatchId}
        workspacePath={workspacePath}
      />
      {suggestions && <ShuntSuggestionCard suggestions={suggestions} />}
    </>
  );
}
