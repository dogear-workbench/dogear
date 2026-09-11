import { useState, useEffect, useCallback, useRef } from 'react';
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
 * error 时不写入 transcript（保留已有数据），错误原因与重试经 historyError / retryHistory 暴露。
 */
export function useMessageHistory({ conversationId, workspaceId, loadHistory }: UseMessageHistoryParams) {
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadIdRef = useRef(0);

  const loadHistoryFromDisk = useCallback(async () => {
    // retry 或 conversationId 切换都会自增 loadId，使在途请求的旧结果失效
    const loadId = ++loadIdRef.current;
    const stale = () => loadIdRef.current !== loadId;

    setHistoryLoaded(false);
    setHistoryStatus('loading');
    setHistoryError(null);

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
      if (stale()) return;

      if (result.status === 'error') {
        console.error('读取对话历史失败:', result.error);
        setHistoryStatus('error');
        setHistoryError(result.error);
        setHistoryConversationId(conversationId);
        setHistoryLoaded(true);
        return;
      }

      loadHistory(result.messages);
      setHistoryStatus(result.status);
      setHistoryConversationId(conversationId);
      setHistoryLoaded(true);
    } catch (error) {
      if (stale()) return;
      console.error('加载对话历史失败:', error);
      setHistoryStatus('error');
      setHistoryError(error instanceof Error ? error.message : String(error));
      setHistoryConversationId(conversationId);
      setHistoryLoaded(true);
    }
  }, [conversationId, workspaceId, loadHistory]);

  useEffect(() => {
    void loadHistoryFromDisk();
    return () => {
      loadIdRef.current++;
    };
  }, [loadHistoryFromDisk]);

  const retryHistory = useCallback(() => {
    if (!conversationId) return;
    void loadHistoryFromDisk();
  }, [conversationId, loadHistoryFromDisk]);

  return {
    historyLoaded: historyLoaded && historyConversationId === conversationId,
    setHistoryLoaded,
    historyStatus,
    historyError,
    retryHistory,
  };
}
