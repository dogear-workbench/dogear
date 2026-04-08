import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { rendererEvents } from '@/lib/events';
import type { Message } from '../types';
import { streamReducer } from '../transformers';

interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
}

/**
 * 监听会话消息流，处理各种消息类型并更新消息状态
 * 从 AgentChat.tsx 提取的核心消息监听逻辑
 */
export function useSessionMessages({
  sessionId,
  showReplayMessages,
  setMessages,
  setIsLoading,
  setHistoryLoaded,
}: UseSessionMessagesParams): void {
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      // 处理 bot 发送的 user 消息（实时显示 bot 输入）
      if ((extendedMsg as any).type === 'human' && (extendedMsg as any).message?.role === 'user') {
        const botMsg = extendedMsg as any;
        setMessages((prev) => [
          ...prev,
          {
            role: 'user' as const,
            content: botMsg.message.content,
            timestamp: new Date().toISOString(),
            contentBlocks: [],
            source: botMsg.source,
          },
        ]);
        return;
      }

      // 如果是重放消息且不显示重放消息，跳过
      if (extendedMsg.isReplay && !showReplayMessages) return;

      setMessages(prev => {
        const result = streamReducer(prev, extendedMsg, showReplayMessages);
        if (result === null) return prev;
        return result;
      });

      // 收到用户消息时标记历史已加载
      if (extendedMsg.type === 'user') {
        setHistoryLoaded(true);
      }

      // 收到结果消息时结束加载状态
      if (extendedMsg.type === 'result') {
        setIsLoading(false);
        setHistoryLoaded(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, showReplayMessages]);
}
