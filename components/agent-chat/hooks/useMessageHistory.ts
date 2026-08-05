import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Message } from '../types';

interface UseMessageHistoryParams {
  conversationId: string | null;
}

export type HistoryStatus = 'loading' | 'ok' | 'empty' | 'error';

/**
 * 历史消息加载 Hook
 * 以 conversationId 为唯一入口调用 getConversationHistory：主进程按 Conversation 状态
 * 返回 ok（正常历史）/ empty（新对话尚无 sessionId）/ error（读取失败）三种状态。
 */
export function useMessageHistory({ conversationId }: UseMessageHistoryParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setHistoryLoaded(false);
      setHistoryStatus('loading');

      if (!conversationId) {
        setMessages([]);
        setHistoryStatus('empty');
        setHistoryConversationId(null);
        setHistoryLoaded(true);
        return;
      }

      const workspaceId = useWorkspaceStore.getState().workspace?.id || '';
      try {
        const result = await client.getConversationHistory({ conversationId, workspaceId });
        if (cancelled) return;

        if (result.status === 'error') {
          console.error('读取对话历史失败:', result.error);
          setMessages([]);
          setHistoryStatus('error');
          setHistoryConversationId(conversationId);
          setHistoryLoaded(true);
          return;
        }

        setMessages(result.messages);
        setHistoryStatus(result.status);
        setHistoryConversationId(conversationId);
        setHistoryLoaded(true);
      } catch (error) {
        if (cancelled) return;
        console.error('加载对话历史失败:', error);
        setMessages([]);
        setHistoryStatus('error');
        setHistoryConversationId(conversationId);
        setHistoryLoaded(true);
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return {
    messages,
    setMessages,
    historyLoaded: historyLoaded && historyConversationId === conversationId,
    setHistoryLoaded,
    historyStatus,
  };
}
