import { create } from 'zustand';

/** 单个子代理的信息 */
export interface SubAgentInfo {
  agentId: string;
  sdkSessionId: string;
  description?: string;
  subagentType?: string;
  status?: 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolUseCount?: number;
  resultText?: string;
}

interface UIState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  promptSidebarOpen: boolean;
  togglePromptSidebar: () => void;
  closePromptSidebar: () => void;

  // 右侧预览面板
  /** 右侧预览面板是否展开 */
  rightPanelOpen: boolean;
  /** 切换右侧预览面板 */
  toggleRightPanel: () => void;
  /** 展开右侧预览面板 */
  openRightPanel: () => void;
  /** 折叠右侧预览面板 */
  closeRightPanel: () => void;

  // 右侧面板当前 tab
  /** 右侧面板当前 tab：预览 or 子代理列表 */
  rightPanelTab: 'preview' | 'subagents';
  /** 切换右侧面板 tab */
  setRightPanelTab: (tab: 'preview' | 'subagents') => void;

  // 子代理面板（嵌入右侧预览区域）
  /** 按对话 ID 缓存的子代理列表（切换 tab 时不丢失） */
  subAgentsMap: Record<string, SubAgentInfo[]>;
  /** 当前选中查看的子代理 agentId（null 表示显示列表） */
  selectedSubAgentId: string | null;
  /** 设置指定对话的子代理列表 */
  setSubAgents: (conversationId: string, agents: SubAgentInfo[]) => void;
  /** 获取指定对话的子代理列表 */
  getSubAgents: (conversationId: string) => SubAgentInfo[];
  /** 注册一个子代理到指定对话（按需注册） */
  registerSubAgent: (conversationId: string, info: SubAgentInfo) => void;
  /** 选中一个子代理查看详情（null 表示回到列表） */
  selectSubAgent: (agentId: string | null) => void;
  /** 关闭子代理面板（回到正常预览） */
  closeSubAgentPanel: () => void;
  /** 清除指定对话的子代理缓存（关闭 tab 时调用） */
  removeSubAgents: (conversationId: string) => void;
  /** 清空所有缓存（工作区切换时） */
  clearSubAgents: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  promptSidebarOpen: false,
  togglePromptSidebar: () => set((s) => ({ promptSidebarOpen: !s.promptSidebarOpen })),
  closePromptSidebar: () => set({ promptSidebarOpen: false }),

  // 右侧预览面板（默认折叠）
  rightPanelOpen: false,
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),

  // 右侧面板 tab（默认预览）
  rightPanelTab: 'preview',
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  // 子代理面板
  subAgentsMap: {},
  selectedSubAgentId: null,
  setSubAgents: (conversationId, agents) => set((s) => ({
    subAgentsMap: { ...s.subAgentsMap, [conversationId]: agents },
  })),
  getSubAgents: (conversationId) => useUIStore.getState().subAgentsMap[conversationId] || [],
  registerSubAgent: (conversationId, info) => set((s) => {
    const existing = s.subAgentsMap[conversationId] || [];
    if (existing.some(a => a.agentId === info.agentId)) return s;
    return { subAgentsMap: { ...s.subAgentsMap, [conversationId]: [...existing, info] } };
  }),
  selectSubAgent: (agentId) => set({ selectedSubAgentId: agentId }),
  closeSubAgentPanel: () => set({ selectedSubAgentId: null }),
  removeSubAgents: (conversationId) => set((s) => {
    const { [conversationId]: _, ...rest } = s.subAgentsMap;
    return { subAgentsMap: rest, selectedSubAgentId: null };
  }),
  clearSubAgents: () => set({ subAgentsMap: {}, selectedSubAgentId: null }),

  reset: () => set({
    settingsOpen: false,
    promptSidebarOpen: false,
    rightPanelOpen: false,
    rightPanelTab: 'preview',
    subAgentsMap: {},
    selectedSubAgentId: null,
  }),
}));
