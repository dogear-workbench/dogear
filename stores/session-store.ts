/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';

/** 单个会话标签页信息 */
export interface SessionTab {
  conversationId: string;
  conversationTitle: string;
  sessionId: string | null;  // agent session ID，初始为 null
  isStreaming: boolean;       // 是否正在运行
  permissionMode: string;     // 权限模式
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;  // 当前显示的 conversationId

  /** 打开标签页（已存在则切换到该标签） */
  openTab: (conversationId: string, title: string) => boolean;
  /** 关闭标签页 */
  closeTab: (conversationId: string) => void;
  /** 切换到指定标签页 */
  switchTab: (conversationId: string) => void;
  /** 更新标签页的 session 信息 */
  updateSession: (conversationId: string, sessionId: string, permissionMode: string) => void;
  /** 更新标签页的运行状态 */
  updateStreaming: (conversationId: string, isStreaming: boolean) => void;
  /** 更新标签页标题 */
  updateTitle: (conversationId: string, title: string) => void;
  /** 获取指定标签页 */
  getTab: (conversationId: string) => SessionTab | undefined;
}

const MAX_TABS = 5;

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (conversationId, title) => {
    const existing = get().tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      set({ activeTabId: conversationId });
      return true;
    }
    if (get().tabs.length >= MAX_TABS) {
      return false; // 达到上限，由调用方提示用户
    }
    set((state) => ({
      tabs: [...state.tabs, {
        conversationId,
        conversationTitle: title,
        sessionId: null,
        isStreaming: false,
        permissionMode: 'default',
      }],
      activeTabId: conversationId,
    }));
    return true;
  },

  closeTab: (conversationId) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.conversationId !== conversationId);
      let newActive = state.activeTabId;
      if (state.activeTabId === conversationId) {
        newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].conversationId : null;
      }
      return { tabs: newTabs, activeTabId: newActive };
    });
  },

  switchTab: (conversationId) => {
    set({ activeTabId: conversationId });
  },

  updateSession: (conversationId, sessionId, permissionMode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, sessionId, permissionMode }
          : t
      ),
    }));
  },

  updateStreaming: (conversationId, isStreaming) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, isStreaming }
          : t
      ),
    }));
  },

  updateTitle: (conversationId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, conversationTitle: title }
          : t
      ),
    }));
  },

  getTab: (conversationId) => {
    return get().tabs.find((t) => t.conversationId === conversationId);
  },
}));
