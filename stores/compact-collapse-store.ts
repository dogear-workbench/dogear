import { create } from 'zustand';

interface CompactCollapseState {
  /** 每个对话独立的折叠状态。key = conversationId，value = 是否折叠 */
  collapsedByConv: Record<string, boolean>;
  /** 查询对话是否折叠（默认 true，未设置时按折叠处理） */
  isCollapsed: (conversationId: string | null | undefined) => boolean;
  /** 切换对话的折叠状态 */
  toggle: (conversationId: string) => void;
  /** 显式设置对话的折叠状态 */
  setCollapsed: (conversationId: string, collapsed: boolean) => void;
}

export const useCompactCollapseStore = create<CompactCollapseState>((set, get) => ({
  collapsedByConv: {},
  isCollapsed: (conversationId) => {
    if (!conversationId) return true;
    const v = get().collapsedByConv[conversationId];
    return v === undefined ? true : v;
  },
  toggle: (conversationId) => set((state) => {
    const current = state.collapsedByConv[conversationId];
    const next = current === undefined ? false : !current;
    return { collapsedByConv: { ...state.collapsedByConv, [conversationId]: next } };
  }),
  setCollapsed: (conversationId, collapsed) => set((state) => ({
    collapsedByConv: { ...state.collapsedByConv, [conversationId]: collapsed },
  })),
}));
