import { useMemo, useState } from 'react';
import { Split, MessageSquarePlus, FolderPlus, StickyNote, Check, Loader2, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useNotesStore } from '@/stores/notes-store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer, type MarkdownRendererProps } from '@/components/MarkdownRenderer';
import { useConversationId } from './conversation-id-context';
import { useGroupId, useWorkspaceId } from './workspace-id-context';
import { useSharedRoot } from './path-link';

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

export const SHUNT_ACTION_META: Record<ShuntAction, { label: string; icon: LucideIcon }> = {
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

interface ShuntResult {
  conversationId: string | null;
  noteId: string | null;
  title: string | null;
  warning: string | null;
}

function openShuntTarget(action: ShuntAction, result: ShuntResult, workspaceId: string | null) {
  if (action === 'note' && result.noteId) {
    useSessionStore.getState().switchTab(NOTES_TAB_ID);
    useNotesStore.getState().setActiveNoteId(result.noteId);
    return;
  }
  if (result.conversationId && workspaceId) {
    void useConversationStore.getState().focusConversationFromLink(
      `dogear://conversation/${result.conversationId}?ws=${encodeURIComponent(workspaceId)}`,
    );
  }
}

function ShuntSuggestionCard({ suggestions }: { suggestions: ShuntSuggestions }) {
  const conversationId = useConversationId();
  const workspaceId = useWorkspaceId();
  const [activeAction, setActiveAction] = useState<ShuntAction | null>(null);
  const [supplement, setSupplement] = useState('');
  const [executing, setExecuting] = useState(false);
  const [done, setDone] = useState(false);

  const cancel = () => {
    setActiveAction(null);
    setSupplement('');
  };

  const handleExecute = async () => {
    if (!conversationId || !activeAction || executing) return;
    const action = activeAction;
    setExecuting(true);
    try {
      const res = await client.executeShunt({
        action,
        summary: suggestions.summary,
        userMessage: supplement.trim(),
        sourceConversationId: conversationId,
      });
      if (!res.ok) {
        toast.error('分流执行失败', { description: res.error ?? undefined });
        return;
      }
      setDone(true);
      cancel();
      const label = SHUNT_ACTION_META[action].label;
      toast.success(`已${label}「${res.title ?? suggestions.summary}」`, {
        description: res.warning ?? undefined,
        action: { label: '打开', onClick: () => openShuntTarget(action, res, workspaceId) },
      });
    } catch (err) {
      toast.error('分流执行失败', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setExecuting(false);
    }
  };

  const meta = activeAction ? SHUNT_ACTION_META[activeAction] : null;
  const ActiveIcon = meta?.icon;

  return (
    <div className="my-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-xs ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground mb-2'}`}>
        {done ? <Check size={12} className="flex-shrink-0" /> : <Split size={12} className="flex-shrink-0" />}
        <span className="flex-shrink-0">{done ? '已分流 ✓' : '这个话题可以单独处理：'}</span>
        <span className="text-foreground/80 truncate" title={suggestions.summary}>{suggestions.summary}</span>
      </div>
      {!done && (activeAction ? (
        <div className="space-y-2">
          {meta && ActiveIcon && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ActiveIcon size={12} className="flex-shrink-0" />
              <span>{meta.label}</span>
            </div>
          )}
          <Textarea
            value={supplement}
            onChange={(e) => setSupplement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleExecute();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                if (!executing) cancel();
              }
            }}
            placeholder={activeAction === 'note' ? '补充内容（可留空）' : '补充给新会话（可留空）'}
            className="min-h-14 text-xs"
            disabled={executing}
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-7 px-3 text-xs" onClick={() => void handleExecute()} disabled={executing}>
              {executing ? <Loader2 size={12} className="mr-1 animate-spin" /> : ActiveIcon && <ActiveIcon size={12} className="mr-1" />}
              {executing ? '执行中…' : '确认分流'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={cancel} disabled={executing}>
              <X size={12} className="mr-1" />
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.options.map((action) => {
            const optionMeta = SHUNT_ACTION_META[action];
            const OptionIcon = optionMeta.icon;
            return (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setActiveAction(action)}
              >
                <OptionIcon size={12} className="mr-1" />
                {optionMeta.label}
              </Button>
            );
          })}
        </div>
      ))}
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
  const groupId = useGroupId();
  const sharedRoot = useSharedRoot(groupId);
  const extraRoots = useMemo(() => (sharedRoot ? [sharedRoot] : undefined), [sharedRoot]);
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
        extraRoots={extraRoots}
        sharedGroupId={groupId ?? undefined}
      />
      {suggestions && <ShuntSuggestionCard suggestions={suggestions} />}
    </>
  );
}
