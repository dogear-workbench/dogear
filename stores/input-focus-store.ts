import { create } from 'zustand';

/**
 * 输入框聚焦请求：引用跳转等场景按 conversationId 寻址，
 * ChatInputArea 订阅对应 seq，变化即聚焦自己的 textarea
 */
interface InputFocusState {
  focusSeq: Record<string, number>;
  requestFocus: (conversationId: string) => void;
}

export const useInputFocusStore = create<InputFocusState>((set) => ({
  focusSeq: {},
  requestFocus: (conversationId) =>
    set((state) => ({
      focusSeq: { ...state.focusSeq, [conversationId]: (state.focusSeq[conversationId] ?? 0) + 1 },
    })),
}));
