import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { rendererEvents } from '@/lib/events';
import type { TranscriptEvent } from './useTranscriptState';

interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  applyStreamEvent: (e: TranscriptEvent) => void;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
}

/**
 * 监听会话消息流：事件按归属表分流进 transcript（stable/live/pendingActions），
 * 本 hook 只保留流式加载态与 historyLoaded 的副作用
 */
export function useSessionMessages({
  sessionId,
  showReplayMessages,
  applyStreamEvent,
  setIsLoading,
  setHistoryLoaded,
}: UseSessionMessagesParams): void {
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      if (extendedMsg.isReplay && !showReplayMessages) return;

      applyStreamEvent(extendedMsg);

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
  }, [sessionId, showReplayMessages, applyStreamEvent]);
}
