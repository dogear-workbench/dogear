/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { PiPermissionMode } from '@/types/settings';

/** 常驻「首页」tab 的哨兵 id（非真实会话） */
export const HOME_TAB_ID = '__home__';

/** 常驻「笔记」tab 的哨兵 id（非真实会话） */
export const NOTES_TAB_ID = '__notes__';

/** 常驻「数据中心」tab 的哨兵 id（非真实会话） */
export const DATA_CENTER_TAB_ID = '__data_center__';

/** 单个会话标签页信息 */
export interface SessionTab {
  conversationId: string;
  conversationTitle: string;
  workspaceId: string;           // 会话所属工作区（里程碑 1.5：Tab 跨工作区保留）
  sessionId: string | null;      // agent session ID，初始为 null
  attachmentId: string | null;   // runtime attachment ID，用于 detach
  permissionMode: PiPermissionMode;        // 权限模式
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string | null;  // 当前显示的 tab id（conversationId 或 HOME/NOTES_TAB_ID 哨兵）
  /** 当前在独立窗口中打开的会话 ID 集合 */
  sessionWindowIds: Set<string>;
  /** 最近一次"被点击"的对话列表节点 id（用于双层高亮区分"焦点节点" vs "已打开同会话其他节点"） */
  lastFocusedNodeId: string | null;

  /** 打开标签页（已存在则切换到该标签） */
  openTab: (conversationId: string, title: string, workspaceId: string) => boolean;
  /** 关闭标签页 */
  closeTab: (conversationId: string) => void;
  /** 切换到指定标签页 */
  switchTab: (conversationId: string) => void;
  /** 更新标签页的 session 信息 */
  updateSession: (conversationId: string, sessionId: string, permissionMode: PiPermissionMode, attachmentId?: string) => void;
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
  /** 设置最近聚焦的节点 id */
  setLastFocusedNodeId: (nodeId: string | null) => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

// 里程碑 1.5：Tab 上限对齐后端 MAX_ACTIVE_SESSIONS=10
const MAX_TABS = 10;

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: HOME_TAB_ID,
  sessionWindowIds: new Set<string>(),
  lastFocusedNodeId: null,

  openTab: (conversationId, title, workspaceId) => {
    const existing = get().tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      set({ activeTabId: conversationId });
      return true;
    }
    if (get().tabs.length >= MAX_TABS) {
      // 达到上限：统一在 store 层 toast 提示，调用方无需处理
      toast.warning(`最多只能同时打开 ${MAX_TABS} 个会话`, {
        description: '请先关闭一些标签页再打开新对话',
      });
      return false;
    }
    set((state) => ({
      tabs: [...state.tabs, {
        conversationId,
        conversationTitle: title,
        workspaceId,
        sessionId: null,
        attachmentId: null,
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
        newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].conversationId : HOME_TAB_ID;
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

  setLastFocusedNodeId: (nodeId) => set({ lastFocusedNodeId: nodeId }),

  reset: () => set({
    tabs: [],
    activeTabId: HOME_TAB_ID,
    sessionWindowIds: new Set<string>(),
    lastFocusedNodeId: null,
  }),
}));
