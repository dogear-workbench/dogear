import { useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { rendererEvents } from '@/lib/events';
import { client } from '@/lib/client';
import type { Message, ContentBlock } from '../types';
import { streamReducer } from '../transformers';
import type { QueuedMessageEntry } from './useSendMessage';

interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
  /** 排队消息缓冲区：Agent 运行中时暂存的消息，result 到达后依次消费 */
  queuedMessagesRef: MutableRefObject<QueuedMessageEntry[]>;
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
}: UseSessionMessagesParams): void {
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

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

      // 收到结果消息时结束加载状态，或消费缓冲区中的下一条排队消息
      if (extendedMsg.type === 'result') {
        const queued = queuedMessagesRef.current;
        if (queued.length > 0) {
          // 取出队头消息，插入到 messages 列表并发送
          const next = queued.shift()!;
          setMessages(prev => [...prev, next.displayMessage, {
            role: 'assistant' as const,
            content: '' as string,
            timestamp: Date.now(),
            isStreaming: true,
            contentBlocks: [] as ContentBlock[],
          }]);
          client.sendQueryBasedSessionMessage({
            sessionId: data.sessionId,
            content: next.content,
            ...(next.textBlocks && { textBlocks: next.textBlocks }),
            ...(next.images && {
              images: next.images.map(img => ({
                media_type: img.mediaType,
                data: img.base64,
              })),
            }),
          }).catch(err => {
            console.error('发送排队消息失败:', err);
            setIsLoading(false);
          });
          // 不调用 setIsLoading(false)，新消息立即开始处理，loading 保持 true
        } else {
          setIsLoading(false);
        }
        setHistoryLoaded(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, showReplayMessages]);
}
