import { useState } from 'react';
import { CornerUpLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationStore } from '@/stores/conversation-store';
import { openOrFocusConversation } from '@/components/conversation-list/utils';
import { useSubSessionDelivered } from './hooks/useSubSessionDelivered';
import type { Conversation } from '@/components/ConversationList';

interface SubSessionDeliveredBannerProps {
  conversation: Conversation;
}

/** 本地分片反查父会话：parentConversationId 直查，缺失时按 contractMetadata.parentSessionId 反查（老数据兜底） */
function findParentConversation(conversation: Conversation): Conversation | undefined {
  const store = useConversationStore.getState();
  const candidates = store.conversations;
  if (conversation.parentConversationId) {
    const parent = candidates.find((c) => c.id === conversation.parentConversationId);
    if (parent) return parent;
  }
  const parentSessionId = conversation.contractMetadata?.parentSessionId;
  if (parentSessionId) {
    return candidates.find((c) => c.sessionId === parentSessionId);
  }
  return undefined;
}

export function SubSessionDeliveredBanner({ conversation }: SubSessionDeliveredBannerProps) {
  const delivered = useSubSessionDelivered(conversation.id);
  const [dismissed, setDismissed] = useState(false);

  if (!delivered || dismissed) return null;

  const goBack = () => {
    const parent = findParentConversation(conversation);
    if (parent) {
      openOrFocusConversation(parent, parent.groupId ? `topic:${parent.groupId}:${parent.id}` : undefined);
      return;
    }
    // 本地分片未命中（子会话 tab 跨工作区保留）：深链跳转自带工作区切换与高亮
    if (conversation.parentConversationId && conversation.workspaceId) {
      void useConversationStore.getState().focusConversationFromLink(
        `dogear://conversation/${conversation.parentConversationId}?ws=${conversation.workspaceId}`,
      );
      return;
    }
    toast.error('找不到主会话', { description: '父会话可能已被删除' });
  };

  const inSessionWindow = window.location.hash.startsWith('#/session-window/');

  return (
    <div className="px-3 pt-2">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-300">
        <CornerUpLeft size={12} className="flex-shrink-0" />
        <span className="flex-shrink-0 font-medium">任务已交付</span>
        <span className="truncate">新任务建议回主会话发送</span>
        {!inSessionWindow && (
          <button
            type="button"
            onClick={goBack}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-700 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          >
            回主会话
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 ml-auto p-0.5 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          title="关闭"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
