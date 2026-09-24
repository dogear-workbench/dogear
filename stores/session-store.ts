/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import type { PiPermissionMode } from '@/types/settings';
import { useReferenceStore } from './reference-store';

/** 常驻「笔记」tab 的哨兵 id（非真实会话） */
export const NOTES_TAB_ID = '__notes__';

/** 常驻「数据中心」tab 的哨兵 id（非真实会话，tab 可开关） */
export const DATA_CENTER_TAB_ID = '__data_center__';

/** 「文章阅读」tab 的哨兵 id（非真实会话，挂载由 article-store.selectedArticle 驱动） */
export const ARTICLE_TAB_ID = '__article__';

/** 「归档」tab 的哨兵 id（非真实会话，选中驱动挂载，不落 localStorage） */
export const ARCHIVE_TAB_ID = '__archive__';

/** 「飞书」tab 的哨兵 id（非真实会话，Bot 控制台页面，不落 localStorage） */
export const FEISHU_TAB_ID = '__feishu__';

const SENTINEL_TAB_IDS = new Set([NOTES_TAB_ID, DATA_CENTER_TAB_ID, ARTICLE_TAB_ID, ARCHIVE_TAB_ID, FEISHU_TAB_ID]);

/** 是否哨兵 tab（笔记/数据中心等非真实会话 tab） */
export function isSentinelTabId(id: string): boolean {
  return SENTINEL_TAB_IDS.has(id);
}

const DATA_CENTER_TAB_OPEN_KEY = 'data-center-tab-open';

function readDataCenterTabOpen(): boolean {
  try {
    return localStorage.getItem(DATA_CENTER_TAB_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 关闭/弹出当前 tab 后的回退目标：最近可用会话 tab，无则空态（不兜底哨兵） */
function pickFallbackConversationTab(s: Pick<SessionState, 'tabs' | 'lastActiveConversationTabId' | 'sessionWindowIds'>): string | null {
  const last = s.lastActiveConversationTabId;
  if (last && s.tabs.some((t) => t.conversationId === last) && !s.sessionWindowIds.has(last)) {
    return last;
  }
  for (let i = s.tabs.length - 1; i >= 0; i--) {
    if (!s.sessionWindowIds.has(s.tabs[i].conversationId)) return s.tabs[i].conversationId;
  }
  return null;
}

/** 常驻笔记 tab 兜底：无可用会话 tab 时回笔记（弹出中不可落，返回空态） */
function pickFallbackTab(s: Pick<SessionState, 'tabs' | 'lastActiveConversationTabId' | 'sessionWindowIds' | 'notesWindowOpen'>): string | null {
  return pickFallbackConversationTab(s) ?? (s.notesWindowOpen ? null : NOTES_TAB_ID);
}

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
  activeTabId: string | null;  // 当前显示的 tab id（conversationId 或 NOTES/DATA_CENTER 哨兵；null = 空态）
  /** 最近一次激活的真实会话 tab id；切到哨兵 tab 不清膛，笔记页引用按钮以它为锚定目标 */
  lastActiveConversationTabId: string | null;
  /** 当前在独立窗口中打开的会话 ID 集合 */
  sessionWindowIds: Set<string>;
  /** 最近一次"被点击"的对话列表节点 id（用于双层高亮区分"焦点节点" vs "已打开同会话其他节点"） */
  lastFocusedNodeId: string | null;
  /** 数据中心 tab 是否打开（可开关，状态记忆在 localStorage） */
  dataCenterTabOpen: boolean;
  /** 归档 tab 是否打开（不落盘：点开挂载、关闭卸载） */
  archiveTabOpen: boolean;
  /** 飞书 tab 是否打开（不落盘：点开挂载、关闭卸载） */
  feishuTabOpen: boolean;
  /** 笔记窗口弹出中（广播驱动，不落盘）：弹出期间哨兵 tab 从栏里隐藏，关窗恢复 */
  notesWindowOpen: boolean;
  /** 数据中心窗口弹出中（广播驱动，不落盘） */
  dataCenterWindowOpen: boolean;

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
  /** 更新已有 tab 的工作区与标题（会话跨工作区移入后原位改写，避免 closeTab/openTab 触发焦点联动竞态） */
  updateTabWorkspace: (conversationId: string, workspaceId: string, title?: string) => void;
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
  /** 打开数据中心 tab（不存在则挂载）并切换过去 */
  openDataCenterTab: () => void;
  /** 关闭数据中心 tab（卸载）；若当前正在看则回退到笔记或最近会话 tab */
  closeDataCenterTab: () => void;
  /** 打开归档 tab 并切换过去 */
  openArchiveTab: () => void;
  /** 关闭归档 tab（卸载）；若当前正在看则回退到笔记或最近会话 tab */
  closeArchiveTab: () => void;
  openFeishuTab: () => void;
  closeFeishuTab: () => void;
  /** 设置笔记窗口弹出态；弹出时若正停在笔记 tab 则回退到可用 tab */
  setNotesWindowOpen: (open: boolean) => void;
  /** 设置数据中心窗口弹出态；弹出时若正停在数据中心 tab 则回退到可用 tab */
  setDataCenterWindowOpen: (open: boolean) => void;
  /** 从当前停留的不可用 tab（如文章关闭）回退到最近会话 tab 或笔记 */
  fallbackActiveTab: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

// 里程碑 1.5：Tab 上限对齐后端 MAX_ACTIVE_SESSIONS=10
const MAX_TABS = 10;

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: NOTES_TAB_ID,
  lastActiveConversationTabId: null,
  sessionWindowIds: new Set<string>(),
  lastFocusedNodeId: null,
  dataCenterTabOpen: readDataCenterTabOpen(),
  archiveTabOpen: false,
  feishuTabOpen: false,
  notesWindowOpen: false,
  dataCenterWindowOpen: false,

  openTab: (conversationId, title, workspaceId) => {
    const existing = get().tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      set({ activeTabId: conversationId, lastActiveConversationTabId: conversationId });
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
      lastActiveConversationTabId: conversationId,
    }));
    return true;
  },

  closeTab: (conversationId) => {
    useReferenceStore.getState().clearAllFor(conversationId);
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.conversationId !== conversationId);
      let newActive = state.activeTabId;
      if (state.activeTabId === conversationId) {
        newActive = newTabs.length > 0
          ? newTabs[newTabs.length - 1].conversationId
          : pickFallbackTab({ ...state, tabs: newTabs });
      }
      // 最近活跃会话被关时回退到剩余 tab 中最新的一个（数组尾部最近打开）
      const newLastActive = state.lastActiveConversationTabId === conversationId
        ? newTabs.length > 0 ? newTabs[newTabs.length - 1].conversationId : null
        : state.lastActiveConversationTabId;
      return { tabs: newTabs, activeTabId: newActive, lastActiveConversationTabId: newLastActive };
    });
  },

  switchTab: (conversationId) => {
    const state = get();
    // 笔记窗口弹出中主窗口不再承载笔记视图，落回最近可用 tab，避免指向不可见 tab 的悬空态
    if (conversationId === NOTES_TAB_ID && state.notesWindowOpen) {
      set({ activeTabId: pickFallbackTab(state) });
      return;
    }
    // 哨兵 tab（笔记/数据中心）激活不影响「最近活跃会话」记录
    const isConversation = !isSentinelTabId(conversationId);
    set({
      activeTabId: conversationId,
      ...(isConversation ? { lastActiveConversationTabId: conversationId } : {}),
    });
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

  updateTabWorkspace: (conversationId, workspaceId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.conversationId === conversationId
          ? { ...t, workspaceId, ...(title !== undefined ? { conversationTitle: title } : {}) }
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

  openDataCenterTab: () => {
    set({ dataCenterTabOpen: true, activeTabId: DATA_CENTER_TAB_ID });
    try {
      localStorage.setItem(DATA_CENTER_TAB_OPEN_KEY, '1');
    } catch {}
  },

  closeDataCenterTab: () => {
    set((state) => {
      let newActive = state.activeTabId;
      if (state.activeTabId === DATA_CENTER_TAB_ID) {
        newActive = pickFallbackTab(state);
      }
      return { dataCenterTabOpen: false, activeTabId: newActive };
    });
    try {
      localStorage.setItem(DATA_CENTER_TAB_OPEN_KEY, '0');
    } catch {}
  },

  openArchiveTab: () => {
    set({ archiveTabOpen: true, activeTabId: ARCHIVE_TAB_ID });
  },

  closeArchiveTab: () => {
    set((state) => {
      let newActive = state.activeTabId;
      if (state.activeTabId === ARCHIVE_TAB_ID) {
        newActive = pickFallbackTab(state);
      }
      return { archiveTabOpen: false, activeTabId: newActive };
    });
  },

  openFeishuTab: () => {
    set({ feishuTabOpen: true, activeTabId: FEISHU_TAB_ID });
  },

  closeFeishuTab: () => {
    set((state) => {
      let newActive = state.activeTabId;
      if (state.activeTabId === FEISHU_TAB_ID) {
        newActive = pickFallbackTab(state);
      }
      return { feishuTabOpen: false, activeTabId: newActive };
    });
  },

  setNotesWindowOpen: (open) => {
    set((state) => {
      if (open && state.activeTabId === NOTES_TAB_ID) {
        // 此时 state.notesWindowOpen 仍是 false，用 pickFallbackTab 会错误地落回笔记 tab 本身
        return { notesWindowOpen: true, activeTabId: pickFallbackConversationTab(state) };
      }
      return { notesWindowOpen: open };
    });
  },

  setDataCenterWindowOpen: (open) => {
    set((state) => {
      if (open && state.activeTabId === DATA_CENTER_TAB_ID) {
        return { dataCenterWindowOpen: true, activeTabId: pickFallbackConversationTab(state) };
      }
      return { dataCenterWindowOpen: open };
    });
  },

  fallbackActiveTab: () => {
    set((state) => ({ activeTabId: pickFallbackTab(state) }));
  },

  reset: () => set({
    tabs: [],
    activeTabId: NOTES_TAB_ID,
    lastActiveConversationTabId: null,
    sessionWindowIds: new Set<string>(),
    lastFocusedNodeId: null,
    dataCenterTabOpen: readDataCenterTabOpen(),
    archiveTabOpen: false,
    feishuTabOpen: false,
    notesWindowOpen: false,
    dataCenterWindowOpen: false,
  }),
}));
