import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Message } from '../types';

interface UseMessageHistoryParams {
  conversationId: string | null;
  workspaceId?: string | null;
  /** 历史到货后写入 transcript（替换 stable + 清空 live） */
  loadHistory: (msgs: Message[]) => void;
}

export type HistoryStatus = 'loading' | 'ok' | 'empty' | 'error';

/**
 * 历史消息加载 Hook
 * 以 conversationId 为唯一入口调用 getConversationHistory：主进程按 Conversation 状态
 * 返回 ok（正常历史）/ empty（新对话尚无 sessionId）/ error（读取失败）三种状态。
 * 消息本体经 loadHistory 写入 transcript state，本 hook 不再持有 messages。
 */
export function useMessageHistory({ conversationId, workspaceId, loadHistory }: UseMessageHistoryParams) {
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    const loadHistoryFromDisk = async () => {
      setHistoryLoaded(false);
      setHistoryStatus('loading');

      if (!conversationId) {
        loadHistory([]);
        setHistoryStatus('empty');
        setHistoryConversationId(null);
        setHistoryLoaded(true);
        return;
      }

      const wsId = workspaceId ?? (useWorkspaceStore.getState().workspace?.id || '');
      try {
        const result = await client.getConversationHistory({ conversationId, workspaceId: wsId });
        if (cancelled) return;

        if (result.status === 'error') {
          console.error('读取对话历史失败:', result.error);
          loadHistory([]);
          setHistoryStatus('error');
          setHistoryConversationId(conversationId);
          setHistoryLoaded(true);
          return;
        }

        loadHistory(result.messages);
        setHistoryStatus(result.status);
        setHistoryConversationId(conversationId);
        setHistoryLoaded(true);
      } catch (error) {
        if (cancelled) return;
        console.error('加载对话历史失败:', error);
        loadHistory([]);
        setHistoryStatus('error');
        setHistoryConversationId(conversationId);
        setHistoryLoaded(true);
      }
    };

    loadHistoryFromDisk();

    return () => {
      cancelled = true;
    };
  }, [conversationId, loadHistory]);

  return {
    historyLoaded: historyLoaded && historyConversationId === conversationId,
    setHistoryLoaded,
    historyStatus,
  };
}
