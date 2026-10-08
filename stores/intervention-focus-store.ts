import { create } from 'zustand';

/**
 * 人工介入卡焦点跳转请求：主进程 interventionFocus 事件落到本窗口后登记，
 * AgentChat 按 conversationId 匹配消费（滚动定位到卡片）。seq 递增保证同一张卡
 * 重复提醒也能再次触发；消费方自行判断，无需显式清除。
 */
interface InterventionFocusRequest {
  conversationId: string;
  interventionRequestId: string;
  seq: number;
}

interface InterventionFocusState {
  focusReq: InterventionFocusRequest | null;
  requestInterventionFocus: (conversationId: string, interventionRequestId: string) => void;
}

export const useInterventionFocusStore = create<InterventionFocusState>((set) => ({
  focusReq: null,
  requestInterventionFocus: (conversationId, interventionRequestId) =>
    set((state) => ({
      focusReq: {
        conversationId,
        interventionRequestId,
        seq: (state.focusReq?.seq ?? 0) + 1,
      },
    })),
}));
