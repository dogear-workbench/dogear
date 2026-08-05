import { useMemo } from 'react';
import { CornerDownRight } from 'lucide-react';
import { useConversationStore } from '@/stores/conversation-store';
import type { Conversation } from '@/components/ConversationList';

interface LineageBarProps {
  conversation: Conversation;
  onOpenParent?: (parentConversationId: string) => void;
}

/**
 * 溯源条：当 conversation.contractMetadata 存在（agent 派出的会话）时，
 * 顶部显示"由 [派出者标题] 派出：[task]"，可点跳转到派出者会话。
 * 派出者不存在（已删除或不在当前工作区）时显示灰色"派出者已删除"。
 */
export function LineageBar({ conversation, onOpenParent }: LineageBarProps) {
  const conversations = useConversationStore((s) => s.conversations);

  const meta = conversation.contractMetadata;
  const parent = useMemo(() => {
    if (!meta?.parentSessionId) return null;
    return conversations.find((c) => c.session_id === meta.parentSessionId) ?? null;
  }, [meta?.parentSessionId, conversations]);

  if (!meta) return null;

  const task = meta.task;
  const parentTitle = parent?.title ?? '未知';

  if (!parent) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground">
        <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" />
        <span>派出者已删除</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="truncate" title={task}>原任务：{task}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenParent?.(parent.id)}
      className="flex items-center gap-2 px-3 py-2 my-2 w-full rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 hover:bg-blue-100 transition-colors cursor-pointer dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200 dark:hover:bg-blue-900/30 text-left"
      title={`跳转到派出者：${parentTitle}`}
    >
      <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" />
      <span>由</span>
      <span className="font-medium truncate max-w-[200px]">[{parentTitle}]</span>
      <span>派出：</span>
      <span className="truncate flex-1" title={task}>{task}</span>
    </button>
  );
}
