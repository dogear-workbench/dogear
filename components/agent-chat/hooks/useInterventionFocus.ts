import { useEffect } from 'react';
import { useInterventionFocusStore } from '@/stores/intervention-focus-store';
import type { Message } from '../types';

const MAX_ATTEMPTS = 30;
const RETRY_INTERVAL_MS = 100;

/**
 * 人工介入卡焦点跳转消费：按 conversationId 匹配 focusReq，遍历消息流找卡片块所在消息
 * 滚动定位并闪烁；卡片未挂载（初始拉取中）时短暂重试，超时放弃不打扰。
 */
export function useInterventionFocus(
  conversationId: string | null,
  getMessages: () => Message[],
  scrollToMessage: (messageId: string, opts?: { align?: 'top' | 'center' | 'top-third'; flash?: boolean }) => void,
): void {
  const focusReq = useInterventionFocusStore((s) => s.focusReq);

  useEffect(() => {
    if (!focusReq || !conversationId || focusReq.conversationId !== conversationId) return;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      for (const message of getMessages()) {
        if (!message.id) continue;
        const hit = message.contentBlocks?.some(
          (b) => b.type === 'human_intervention' && b.interventionRequestId === focusReq.interventionRequestId,
        );
        if (hit) {
          scrollToMessage(message.id, { align: 'top', flash: true });
          return;
        }
      }
      if (attempts++ < MAX_ATTEMPTS) setTimeout(tryScroll, RETRY_INTERVAL_MS);
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [focusReq, conversationId, getMessages, scrollToMessage]);
}
