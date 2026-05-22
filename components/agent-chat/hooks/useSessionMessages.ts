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
  /** SDK 0.2.119+ 每轮结束后的下一步建议（每轮最多一条） */
  onPromptSuggestion?: (suggestion: string) => void;
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
  onPromptSuggestion,
}: UseSessionMessagesParams): void {
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      if (extendedMsg.isReplay && !showReplayMessages) return;

      // SDK 0.2.119+：下一步建议气泡（独立 UI 状态，不混入消息流）
      if (extendedMsg.type === 'prompt_suggestion') {
        const suggestion = (extendedMsg as { suggestion?: string }).suggestion;
        if (typeof suggestion === 'string' && suggestion.trim()) {
          onPromptSuggestion?.(suggestion);
        }
        return;
      }

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
