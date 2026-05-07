/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';

/** 单个会话标签页信息 */
export interface SessionTab {
  conversationId: string;
  conversationTitle: string;
  workspaceId: string;           // 会话所属工作区（里程碑 1.5：Tab 跨工作区保留）
  sessionId: string | null;      // agent session ID，初始为 null
  attachmentId: string | null;   // runtime attachment ID，用于 detach
  isStreaming: boolean;          // 是否正在运行
  permissionMode: string;        // 权限模式
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;  // 当前显示的 conversationId
  /** 当前在独立窗口中打开的会话 ID 集合 */
  sessionWindowIds: Set<string>;

  /** 打开标签页（已存在则切换到该标签） */
  openTab: (conversationId: string, title: string, workspaceId: string) => boolean;
  /** 关闭标签页 */
  closeTab: (conversationId: string) => void;
  /** 切换到指定标签页 */
  switchTab: (conversationId: string) => void;
  /** 更新标签页的 session 信息 */
  updateSession: (conversationId: string, sessionId: string, permissionMode: string, attachmentId?: string) => void;
  /** 更新标签页的运行状态 */
  updateStreaming: (conversationId: string, isStreaming: boolean) => void;
  /** 更新标签页标题 */
  updateTitle: (conversationId: string, title: string) => void;
  /** 获取指定标签页 */
  getTab: (conversationId: string) => SessionTab | undefined;
  /** 标记会话在独立窗口中打开 */
  addSessionWindow: (conversationId: string) => void;
  /** 标记独立窗口关闭 */
  removeSessionWindow: (conversationId: string) => void;
  /** 检查会话是否在独立窗口中 */
  isInSessionWindow: (conversationId: string) => boolean;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

const MAX_TABS = 5;

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  sessionWindowIds: new Set<string>(),

  openTab: (conversationId, title, workspaceId) => {
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
        workspaceId,
        sessionId: null,
        attachmentId: null,
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

  updateSession: (conversationId, sessionId, permissionMode, attachmentId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, sessionId, permissionMode, ...(attachmentId !== undefined ? { attachmentId } : {}) }
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

  addSessionWindow: (conversationId) => {
    set((state) => {
      const newSet = new Set(state.sessionWindowIds);
      newSet.add(conversationId);
      return { sessionWindowIds: newSet };
    });
  },

  removeSessionWindow: (conversationId) => {
    set((state) => {
      const newSet = new Set(state.sessionWindowIds);
      newSet.delete(conversationId);
      return { sessionWindowIds: newSet };
    });
  },

  isInSessionWindow: (conversationId) => {
    return get().sessionWindowIds.has(conversationId);
  },

  reset: () => set({
    tabs: [],
    activeTabId: null,
    sessionWindowIds: new Set<string>(),
  }),
}));
