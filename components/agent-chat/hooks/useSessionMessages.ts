import { useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { rendererEvents } from '@/lib/events';
import type { Message } from '../types';
import { streamReducer } from '../transformers';
import type { QueuedMessageEntry } from './useSendMessage';

interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
  /** 排队消息悬浮区：Agent 运行中时的排队消息列表（已发后端，仅用于 UI 匹配） */
  queuedMessagesRef: MutableRefObject<QueuedMessageEntry[]>;
  /** 悬浮区消费后同步 React UI state */
  onQueueChanged?: () => void;
  /** SDK 0.2.119+ 每轮结束后的下一步建议（每轮最多一条） */
  onPromptSuggestion?: (suggestion: string) => void;
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
  queuedMessagesRef,
  onQueueChanged,
  onPromptSuggestion,
}: UseSessionMessagesParams): void {
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      // 如果是重放消息且不显示重放消息，跳过
      if (extendedMsg.isReplay && !showReplayMessages) return;

      // SDK 0.2.119+：下一步建议气泡（独立 UI 状态，不混入消息流）
      if (extendedMsg.type === 'prompt_suggestion') {
        const suggestion = (extendedMsg as { suggestion?: string }).suggestion;
        if (typeof suggestion === 'string' && suggestion.trim()) {
          onPromptSuggestion?.(suggestion);
        }
        return;
      }

      // UI 已在 useSendMessage 中插入排队消息，这里只对账消费队列，不重复 push
      if (extendedMsg.type === 'user' && !extendedMsg.isReplay) {
        const queued = queuedMessagesRef.current;
        const isMeta = 'isMeta' in extendedMsg && extendedMsg.isMeta;
        const isBot = 'source' in extendedMsg && extendedMsg.source === 'wechat-bot';
        if (queued.length > 0 && !isMeta && !isBot) {
          queued.shift();
          onQueueChanged?.();
          setHistoryLoaded(true);
          return;
        }
      }

      setMessages(prev => {
        const result = streamReducer(prev, extendedMsg, showReplayMessages);
        if (result === null) return prev;
        return result;
      });

      // 收到用户消息时标记历史已加载
      if (extendedMsg.type === 'user') {
        setHistoryLoaded(true);
      }

      // 收到结果消息时：队列为空则结束 loading，有排队消息则保持 loading
      if (extendedMsg.type === 'result') {
        if (queuedMessagesRef.current.length === 0) {
          setIsLoading(false);
        }
        // 有排队消息时保持 isLoading=true，后端会继续处理下一条
        setHistoryLoaded(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, showReplayMessages]);
}
