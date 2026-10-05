/**
 * 多会话标签页状态管理
 * 管理多个并行运行的 Agent 会话标签页
 */
import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
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

/** 「网页 AI」tab 的哨兵 id（非真实会话，内嵌网页 AI 站点，不落 localStorage） */
export const WEB_AI_TAB_ID = '__webai__';

const SENTINEL_TAB_IDS = new Set([NOTES_TAB_ID, DATA_CENTER_TAB_ID, ARTICLE_TAB_ID, ARCHIVE_TAB_ID, FEISHU_TAB_ID, WEB_AI_TAB_ID]);

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

/** 剩余 tab 中 lastActiveAt 最大者（重排后数组尾部 = 最久未活跃，回退目标不可再用位置语义） */
function mostRecentTab(tabs: SessionTab[], excludeIds: Set<string> | null): SessionTab | null {
  let best: SessionTab | null = null;
  for (const t of tabs) {
    if (excludeIds?.has(t.conversationId)) continue;
    if (!best || t.lastActiveAt > best.lastActiveAt) best = t;
  }
  return best;
}

/** 未读在前（组内 lastActiveAt 降序），其余 lastActiveAt 降序；稳定排序保持原相对顺序 */
export function sortTabs(tabs: SessionTab[], unreadIds: Set<string>): SessionTab[] {
  return [...tabs].sort((a, b) => {
    const aUnread = unreadIds.has(a.conversationId) ? 1 : 0;
    const bUnread = unreadIds.has(b.conversationId) ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return b.lastActiveAt - a.lastActiveAt;
  });
}

/** 关闭/弹出当前 tab 后的回退目标：最近可用会话 tab，无则空态（不兜底哨兵） */
function pickFallbackConversationTab(s: Pick<SessionState, 'tabs' | 'lastActiveConversationTabId' | 'sessionWindowIds'>): string | null {
  const last = s.lastActiveConversationTabId;
  if (last && s.tabs.some((t) => t.conversationId === last) && !s.sessionWindowIds.has(last)) {
    return last;
  }
  return mostRecentTab(s.tabs, s.sessionWindowIds)?.conversationId ?? null;
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
  lastActiveAt: number;          // 最近一次成为焦点的 epoch ms（LRU 排序与满员回收依据）
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
  /** 网页 AI tab 是否打开（不落盘：点开挂载、关闭卸载） */
  webAiTabOpen: boolean;
  /** 网页 AI 当前选中站点 id（内存态不落盘；过期 id 由读取处 resolveSelectedSite 归一化） */
  webAiSelectedSiteId: string | null;
  /** 笔记窗口弹出中（广播驱动，不落盘）：弹出期间哨兵 tab 从栏里隐藏，关窗恢复 */
  notesWindowOpen: boolean;
  /** 数据中心窗口弹出中（广播驱动，不落盘） */
  dataCenterWindowOpen: boolean;

  /** 打开标签页（已存在则切换到该标签；满员时先回收最久未活跃的可回收 tab） */
  openTab: (conversationId: string, title: string, workspaceId: string) => Promise<boolean>;
  /** 关闭标签页 */
  closeTab: (conversationId: string) => void;
  /** 切换到指定标签页 */
  switchTab: (conversationId: string) => void;
  /** 焦点到达会话 tab：刷新 lastActiveAt 并按未读/活跃重排（focusedConversationChanged 驱动） */
  touchTabActivity: (conversationId: string) => void;
  /** unread 翻转后重排（未读跳到最前）；顺序无变化时保持引用不变 */
  reorderTabs: () => void;
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
  /** 打开网页 AI tab 并切换过去 */
  openWebAiTab: () => void;
  /** 关闭网页 AI tab（卸载）；若当前正在看则回退到笔记或最近会话 tab */
  closeWebAiTab: () => void;
  setWebAiSelectedSiteId: (id: string | null) => void;
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

// conversation-store 顶层 import 本模块，此处反向依赖只能动态引；openTab 满员回收与排序需要读运行/待确认/未读集合
let conversationStoreState: (() => {
  runningConversationIds: Set<string>;
  pendingActionConversationIds: Set<string>;
  byWorkspace: Record<string, { conversations: Array<{ id: string; unread?: boolean }> }>;
  personalConversations: Array<{ id: string; unread?: boolean }>;
}) | null = null;
import('./conversation-store').then(({ useConversationStore }) => {
  conversationStoreState = () => useConversationStore.getState();
});

function collectUnreadIds(): Set<string> {
  const cs = conversationStoreState?.();
  const ids = new Set<string>();
  if (!cs) return ids;
  for (const slice of Object.values(cs.byWorkspace)) {
    for (const c of slice.conversations) if (c.unread) ids.add(c.id);
  }
  for (const c of cs.personalConversations) if (c.unread) ids.add(c.id);
  return ids;
}

/** 满员回收：找「非运行中、非等待确认、非未读、非独立窗口弹出中」且 lastActiveAt 最小的 tab，关后端 session 后移除；无可回收者返回 null */
async function recycleIdleTab(get: () => SessionState): Promise<SessionTab | null> {
  const cs = conversationStoreState?.();
  if (!cs) return null;
  const unreadIds = collectUnreadIds();
  const state = get();
  const candidates = state.tabs.filter((t) =>
    !cs.runningConversationIds.has(t.conversationId) &&
    !cs.pendingActionConversationIds.has(t.conversationId) &&
    !unreadIds.has(t.conversationId) &&
    !state.sessionWindowIds.has(t.conversationId)
  );
  if (candidates.length === 0) return null;
  const victim = candidates.reduce((min, t) => (t.lastActiveAt < min.lastActiveAt ? t : min));
  if (victim.sessionId) {
    try {
      await client.closeQueryBasedSession({ sessionId: victim.sessionId });
    } catch (err) {
      console.error('回收闲置会话：关闭后端会话失败（忽略继续）:', err);
    }
  }
  get().closeTab(victim.conversationId);
  return victim;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  tabs: [],
  activeTabId: NOTES_TAB_ID,
  lastActiveConversationTabId: null,
  sessionWindowIds: new Set<string>(),
  lastFocusedNodeId: null,
  dataCenterTabOpen: readDataCenterTabOpen(),
  archiveTabOpen: false,
  feishuTabOpen: false,
  webAiTabOpen: false,
  webAiSelectedSiteId: null,
  notesWindowOpen: false,
  dataCenterWindowOpen: false,

  openTab: async (conversationId, title, workspaceId) => {
    const existing = get().tabs.find((t) => t.conversationId === conversationId);
    if (existing) {
      set({ activeTabId: conversationId, lastActiveConversationTabId: conversationId });
      return true;
    }
    if (get().tabs.length >= MAX_TABS) {
      const evicted = await recycleIdleTab(get);
      if (!evicted) {
        // 达到上限且无可回收 tab：统一在 store 层 toast 提示，调用方无需处理
        toast.warning(`最多只能同时打开 ${MAX_TABS} 个会话`, {
          description: '请先关闭一些标签页再打开新对话',
        });
        return false;
      }
      toast.success(`已释放闲置会话 ${evicted.conversationTitle}`);
    }
    set((state) => ({
      tabs: [...state.tabs, {
        conversationId,
        conversationTitle: title,
        workspaceId,
        sessionId: null,
        attachmentId: null,
        permissionMode: 'default',
        lastActiveAt: Date.now(),
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
        const fallback = mostRecentTab(newTabs, null);
        newActive = fallback ? fallback.conversationId : pickFallbackTab({ ...state, tabs: newTabs });
      }
      // 最近活跃会话被关时回退到剩余 tab 中最近活跃的一个
      const newLastActive = state.lastActiveConversationTabId === conversationId
        ? mostRecentTab(newTabs, null)?.conversationId ?? null
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
    if (isConversation) get().touchTabActivity(conversationId);
    set({
      activeTabId: conversationId,
      ...(isConversation ? { lastActiveConversationTabId: conversationId } : {}),
    });
  },

  touchTabActivity: (conversationId) => {
    set((state) => {
      if (!state.tabs.some((t) => t.conversationId === conversationId)) return state;
      const now = Date.now();
      const tabs = sortTabs(
        state.tabs.map((t) => (t.conversationId === conversationId ? { ...t, lastActiveAt: now } : t)),
        collectUnreadIds(),
      );
      return { tabs };
    });
  },

  reorderTabs: () => {
    set((state) => {
      const sorted = sortTabs(state.tabs, collectUnreadIds());
      if (sorted.every((t, i) => t === state.tabs[i])) return state;
      return { tabs: sorted };
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

  openWebAiTab: () => {
    set({ webAiTabOpen: true, activeTabId: WEB_AI_TAB_ID });
  },

  closeWebAiTab: () => {
    set((state) => {
      let newActive = state.activeTabId;
      if (state.activeTabId === WEB_AI_TAB_ID) {
        newActive = pickFallbackTab(state);
      }
      return { webAiTabOpen: false, activeTabId: newActive };
    });
  },

  setWebAiSelectedSiteId: (id) => set({ webAiSelectedSiteId: id }),

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
    webAiTabOpen: false,
    webAiSelectedSiteId: null,
    notesWindowOpen: false,
    dataCenterWindowOpen: false,
  }),
}));
