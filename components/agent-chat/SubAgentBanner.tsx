import { useMemo } from 'react';
import { CornerDownRight, FileOutput } from 'lucide-react';
import { useConversationStore } from '@/stores/conversation-store';
import type { ChildStatus } from '@/types/delegation';
import type { Conversation } from '@/components/ConversationList';

interface SubAgentBannerProps {
  conversation: Conversation;
  /** 点击主会话链接时切换 */
  onOpenParent?: (parentConversationId: string) => void;
}

function statusBadge(status: ChildStatus | undefined): { text: string; cls: string } {
  switch (status) {
    case 'running':     return { text: '运行中', cls: 'text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300' };
    case 'done':        return { text: '已交付', cls: 'text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300' };
    case 'failed':      return { text: '失败', cls: 'text-destructive bg-red-50 dark:bg-red-900/30' };
    case 'timeout':     return { text: '超时', cls: 'text-muted-foreground bg-muted/50' };
    case 'cancelled':   return { text: '已停止', cls: 'text-muted-foreground bg-muted/50' };
    case 'no_delivery': return { text: '未交付', cls: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300' };
    default:            return { text: '快照缺失', cls: 'text-muted-foreground bg-muted/50' };
  }
}

/** 子会话顶部 banner：显示父会话标题 + 交付路径 + 状态。仅当 conversation.role === 'sub' 时渲染。 */
export function SubAgentBanner({ conversation, onOpenParent }: SubAgentBannerProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const childrenByParent = useConversationStore((s) => s.childrenByParent);

  const parentId = conversation.parent_conversation_id;
  const parentTitle = useMemo(() => {
    if (!parentId) return '未知主会话';
    const parent = conversations.find((c) => c.id === parentId);
    return parent?.title || '未知主会话';
  }, [parentId, conversations]);

  // 从 childrenByParent 反查本子会话的 bridge 快照
  const snapshot = useMemo(() => {
    if (!parentId) return null;
    const list = childrenByParent[parentId] ?? [];
    return list.find((c) => c.childId === conversation.id) ?? null;
  }, [childrenByParent, parentId, conversation.id]);

  if (conversation.role !== 'sub') return null;

  const badge = statusBadge(snapshot?.status);

  return (
    <div className="flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-200">
      <CornerDownRight className="w-3.5 h-3.5 flex-shrink-0" />
      <span>来自主会话</span>
      {parentId ? (
        <button
          onClick={() => onOpenParent?.(parentId)}
          className="font-medium hover:underline cursor-pointer truncate max-w-[200px]"
          title={parentTitle}
        >
          [{parentTitle}]
        </button>
      ) : (
        <span className="font-medium truncate max-w-[200px]">[{parentTitle}]</span>
      )}
      <span>的委派</span>
      {snapshot?.outputPath && (
        <>
          <span className="text-amber-700/60 dark:text-amber-300/60">·</span>
          <FileOutput className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-mono truncate" title={snapshot.outputPath}>{snapshot.outputPath}</span>
        </>
      )}
      <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${badge.cls}`}>
        {badge.text}
      </span>
    </div>
  );
}
