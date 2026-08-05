import { create } from 'zustand';

/** 单个子代理的信息 */
export interface SubAgentInfo {
  agentId: string;
  sdkSessionId: string;
  description?: string;
  subagentType?: string;
  /** 子代理使用的模型（来自结果消息携带的 model 字段） */
  model?: string;
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

  // 左侧面板 tab
  /** 左侧面板当前 tab：对话列表 or 文件浏览器 */
  leftPanelTab: 'conversations' | 'explorer';
  /** 切换左侧面板 tab */
  setLeftPanelTab: (tab: 'conversations' | 'explorer') => void;

  // 左侧面板折叠（里程碑 1.5 Step A2.5）
  /** 左侧面板是否展开 */
  leftPanelOpen: boolean;
  /** 切换左侧面板 */
  toggleLeftPanel: () => void;

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
  /** 右侧面板当前 tab：预览 / 子代理列表 / 共享区 */
  rightPanelTab: 'preview' | 'subagents' | 'shared';
  /** 切换右侧面板 tab */
  setRightPanelTab: (tab: 'preview' | 'subagents' | 'shared') => void;

  // 子代理面板（嵌入右侧预览区域）
  /** 按对话 ID 缓存的子代理列表（切换 tab 时不丢失） */
  subAgentsMap: Record<string, SubAgentInfo[]>;
  /** 按对话 ID 缓存的"当前选中子代理"——避免跨对话污染 */
  selectedSubAgentMap: Record<string, string | null>;
  /** 设置指定对话的子代理列表 */
  setSubAgents: (conversationId: string, agents: SubAgentInfo[]) => void;
  /** 获取指定对话的子代理列表 */
  getSubAgents: (conversationId: string) => SubAgentInfo[];
  /** 注册一个子代理到指定对话（按需注册） */
  registerSubAgent: (conversationId: string, info: SubAgentInfo) => void;
  /** 选中一个子代理查看详情（null 表示回到列表） */
  selectSubAgent: (conversationId: string, agentId: string | null) => void;
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

  // 左侧面板 tab（默认对话列表）
  leftPanelTab: 'conversations',
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),

  // 左侧面板折叠（默认展开）
  leftPanelOpen: true,
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),

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
  selectedSubAgentMap: {},
  setSubAgents: (conversationId, agents) => set((s) => ({
    subAgentsMap: { ...s.subAgentsMap, [conversationId]: agents },
  })),
  getSubAgents: (conversationId) => useUIStore.getState().subAgentsMap[conversationId] || [],
  registerSubAgent: (conversationId, info) => set((s) => {
    const existing = s.subAgentsMap[conversationId] || [];
    if (existing.some(a => a.agentId === info.agentId)) return s;
    return { subAgentsMap: { ...s.subAgentsMap, [conversationId]: [...existing, info] } };
  }),
  selectSubAgent: (conversationId, agentId) => set((s) => ({
    selectedSubAgentMap: { ...s.selectedSubAgentMap, [conversationId]: agentId },
  })),
  removeSubAgents: (conversationId) => set((s) => {
    const { [conversationId]: _agents, ...restAgents } = s.subAgentsMap;
    const { [conversationId]: _sel, ...restSel } = s.selectedSubAgentMap;
    return { subAgentsMap: restAgents, selectedSubAgentMap: restSel };
  }),
  clearSubAgents: () => set({ subAgentsMap: {}, selectedSubAgentMap: {} }),

  reset: () => set({
    settingsOpen: false,
    promptSidebarOpen: false,
    leftPanelTab: 'conversations',
    leftPanelOpen: true,
    rightPanelOpen: false,
    rightPanelTab: 'preview',
    subAgentsMap: {},
    selectedSubAgentMap: {},
  }),
}));
