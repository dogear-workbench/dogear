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

      if (extendedMsg.isReplay && !showReplayMessages) return;

      // 插话场景：UI 已在 useSendMessage 中本地立即 push 了用户消息，
      // streamReducer 内部会按 sdk_uuid 做去重，不会重复 push
      setMessages(prev => {
        const result = streamReducer(prev, extendedMsg, showReplayMessages);
        if (result === null) return prev;
        return result;
      });

      if (extendedMsg.type === 'user') {
        setHistoryLoaded(true);
      }

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
