/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';
import { useReferenceStore } from './reference-store';

/** 常驻「笔记」tab 的哨兵 id（非真实会话） */
export const NOTES_TAB_ID = '__notes__';

/** 常驻「数据中心」tab 的哨兵 id（非真实会话，tab 可开关） */
export const DATA_CENTER_TAB_ID = '__data_center__';

/** 常驻「任务」tab 的哨兵 id（非真实会话） */
export const TASKS_TAB_ID = '__tasks__';

/** 常驻「设置」tab 的哨兵 id（非真实会话） */
export const SETTINGS_TAB_ID = '__settings__';


/** 「归档」tab 的哨兵 id（非真实会话，选中驱动挂载，不落 localStorage） */
export const ARCHIVE_TAB_ID = '__archive__';

/** 「飞书」tab 的哨兵 id（非真实会话，Bot 控制台页面，不落 localStorage） */
export const FEISHU_TAB_ID = '__feishu__';

/** 草稿视图 id（未落盘会话的显式视图）；不入 SENTINEL_TAB_IDS——草稿属会话模式，isSentinelTabId 须对其返回 false */
export const DRAFT_VIEW_ID = '__draft__';

const SENTINEL_TAB_IDS = new Set([NOTES_TAB_ID, DATA_CENTER_TAB_ID, TASKS_TAB_ID, SETTINGS_TAB_ID, ARCHIVE_TAB_ID, FEISHU_TAB_ID]);

/** 是否哨兵 tab（笔记/数据中心等非真实会话 tab；草稿视图 id 不是哨兵） */
export function isSentinelTabId(id: string): boolean {
  return SENTINEL_TAB_IDS.has(id);
}

/** 会话模式判定（rail「对话」项激活态；草稿视图也属会话模式，tab 栏可见、列表展开） */
export function isInConversationMode(activeTabId: string): boolean {
  return activeTabId === DRAFT_VIEW_ID || !isSentinelTabId(activeTabId);
}

const DATA_CENTER_TAB_OPEN_KEY = 'data-center-tab-open';

function readDataCenterTabOpen(): boolean {
  try {
    return localStorage.getItem(DATA_CENTER_TAB_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** 剩余 tab 中 lastActiveAt 最大者（关 tab 后回退到最近看过的会话） */
function mostRecentTab(tabs: SessionTab[], excludeIds: Set<string> | null): SessionTab | null {
  let best: SessionTab | null = null;
  for (const t of tabs) {
    if (excludeIds?.has(t.conversationId)) continue;
    if (!best || t.lastActiveAt > best.lastActiveAt) best = t;
  }
  return best;
}

/** 哨兵 tab 对应窗口弹出后的回退目标：切哨兵前开着的视图（含草稿）仍可用则回它，否则最近可用会话 tab，无则落草稿 */
function pickFallbackFromPrevView(s: Pick<SessionState, 'tabs' | 'prevConversationView' | 'sessionWindowIds'>): string {
  const prev = s.prevConversationView;
  if (prev === DRAFT_VIEW_ID) return DRAFT_VIEW_ID;
  if (prev !== null && s.tabs.some((t) => t.conversationId === prev) && !s.sessionWindowIds.has(prev)) return prev;
  return mostRecentTab(s.tabs, s.sessionWindowIds)?.conversationId ?? DRAFT_VIEW_ID;
}

/** 关闭/失效当前 tab 后的回退目标：最近可用会话 tab，无则落草稿（不兜底哨兵；此刻不在哨兵模式，prev 是 stale 值不可用） */
function pickFallbackConversationTab(s: Pick<SessionState, 'tabs' | 'sessionWindowIds'>): string {
  return mostRecentTab(s.tabs, s.sessionWindowIds)?.conversationId ?? DRAFT_VIEW_ID;
}

/** 「非哨兵 → 哨兵」切换时暂存离开前视图（含草稿 DRAFT_VIEW_ID）；哨兵→哨兵不覆盖，切回非哨兵不涉及 */
function nextPrevConversationView(
  s: Pick<SessionState, 'activeTabId' | 'prevConversationView'>,
  nextTabId: string,
): string | null {
  if (nextTabId === DRAFT_VIEW_ID || !isSentinelTabId(nextTabId)) return s.prevConversationView;
  if (isInConversationMode(s.activeTabId)) return s.activeTabId;
  return s.prevConversationView;
}

/** 单个会话标签页信息 */
export interface SessionTab {
  conversationId: string;
  conversationTitle: string;
  workspaceId: string;           // 会话所属工作区（里程碑 1.5：Tab 跨工作区保留）
  lastActiveAt: number;          // 最近一次成为焦点的 epoch ms（关tab回退/闲置淡化依据，不参与排序）
}

interface SessionState {
  tabs: SessionTab[];
  activeTabId: string;  // 当前显示的视图 id（conversationId、NOTES/DATA_CENTER 哨兵或 DRAFT_VIEW_ID）
  /** 切到哨兵 tab 前停留的视图（会话 id 或 DRAFT_VIEW_ID；null=从未离开过会话模式）；回来落地/引用锚定/弹窗回退三处消费，消费后不清除 */
  prevConversationView: string | null;
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
  openTab: (conversationId: string, title: string, workspaceId: string) => void;
  /** 关闭标签页 */
  closeTab: (conversationId: string) => void;
  /** 切换到指定标签页；DRAFT_VIEW_ID 落草稿 */
  switchTab: (conversationId: string) => void;
  /** 焦点到达会话 tab：仅刷新 lastActiveAt（回退/淡化依据），不重排不移动（focusedConversationChanged 驱动） */
  touchTabActivity: (conversationId: string) => void;
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
  /** 打开数据中心 tab（不存在则挂载）并切换过去 */
  openDataCenterTab: () => void;
  /** 打开归档 tab 并切换过去 */
  openArchiveTab: () => void;
  openFeishuTab: () => void;
  /** 设置笔记窗口弹出态；弹出时若正停在笔记 tab 则回退到可用 tab */
  setNotesWindowOpen: (open: boolean) => void;
  /** 设置数据中心窗口弹出态；弹出时若正停在数据中心 tab 则回退到可用 tab */
  setDataCenterWindowOpen: (open: boolean) => void;
  /** 从当前停留的不可用 tab（如文章关闭）回退到最近会话 tab 或草稿态 */
  fallbackActiveTab: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: DRAFT_VIEW_ID,
  prevConversationView: null,
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
      set({ activeTabId: conversationId });
      return;
    }
    set((state) => ({
      tabs: [...state.tabs, {
        conversationId,
        conversationTitle: title,
        workspaceId,
        lastActiveAt: Date.now(),
      }],
      activeTabId: conversationId,
    }));
  },

  closeTab: (conversationId) => {
    useReferenceStore.getState().clearAllFor(conversationId);
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.conversationId !== conversationId);
      let newActive = state.activeTabId;
      if (state.activeTabId === conversationId) {
        newActive = mostRecentTab(newTabs, null)?.conversationId ?? DRAFT_VIEW_ID;
      }
      return { tabs: newTabs, activeTabId: newActive };
    });
  },

  switchTab: (conversationId) => {
    const state = get();
    // 笔记窗口弹出中主窗口不再承载笔记视图，落回最近可用 tab，避免指向不可见 tab 的悬空态
    if (conversationId === NOTES_TAB_ID && state.notesWindowOpen) {
      set({
        activeTabId: pickFallbackConversationTab(state),
        prevConversationView: nextPrevConversationView(state, conversationId),
      });
      return;
    }
    // 哨兵 tab（笔记/数据中心）与草稿视图激活不影响会话 tab 活跃记录
    if (!isSentinelTabId(conversationId) && conversationId !== DRAFT_VIEW_ID) get().touchTabActivity(conversationId);
    set({
      activeTabId: conversationId,
      prevConversationView: nextPrevConversationView(state, conversationId),
    });
  },

  touchTabActivity: (conversationId) => {
    set((state) => {
      if (!state.tabs.some((t) => t.conversationId === conversationId)) return state;
      const now = Date.now();
      const tabs = state.tabs.map((t) => (t.conversationId === conversationId ? { ...t, lastActiveAt: now } : t));
      return { tabs };
    });
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

  openDataCenterTab: () => {
    set((state) => ({
      dataCenterTabOpen: true,
      activeTabId: DATA_CENTER_TAB_ID,
      prevConversationView: nextPrevConversationView(state, DATA_CENTER_TAB_ID),
    }));
    try {
      localStorage.setItem(DATA_CENTER_TAB_OPEN_KEY, '1');
    } catch {}
  },

  openArchiveTab: () => {
    set((state) => ({
      archiveTabOpen: true,
      activeTabId: ARCHIVE_TAB_ID,
      prevConversationView: nextPrevConversationView(state, ARCHIVE_TAB_ID),
    }));
  },

  openFeishuTab: () => {
    set((state) => ({
      feishuTabOpen: true,
      activeTabId: FEISHU_TAB_ID,
      prevConversationView: nextPrevConversationView(state, FEISHU_TAB_ID),
    }));
  },

  setNotesWindowOpen: (open) => {
    set((state) => {
      if (open && state.activeTabId === NOTES_TAB_ID) {
        // 此时 state.notesWindowOpen 仍是 false，直接用 mostRecentTab 会漏掉弹窗前开着的视图，走 prev 优先
        return { notesWindowOpen: true, activeTabId: pickFallbackFromPrevView(state) };
      }
      return { notesWindowOpen: open };
    });
  },

  setDataCenterWindowOpen: (open) => {
    set((state) => {
      if (open && state.activeTabId === DATA_CENTER_TAB_ID) {
        return { dataCenterWindowOpen: true, activeTabId: pickFallbackFromPrevView(state) };
      }
      return { dataCenterWindowOpen: open };
    });
  },

  fallbackActiveTab: () => {
    set((state) => ({ activeTabId: pickFallbackConversationTab(state) }));
  },

  reset: () => set({
    tabs: [],
    activeTabId: DRAFT_VIEW_ID,
    prevConversationView: null,
    sessionWindowIds: new Set<string>(),
    lastFocusedNodeId: null,
    dataCenterTabOpen: readDataCenterTabOpen(),
    archiveTabOpen: false,
    feishuTabOpen: false,
    notesWindowOpen: false,
    dataCenterWindowOpen: false,
  }),
}));
