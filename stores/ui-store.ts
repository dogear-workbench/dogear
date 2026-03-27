import { create } from 'zustand';

/** 单个子代理的信息 */
export interface SubAgentInfo {
  agentId: string;
  sdkSessionId: string;
  description?: string;
  status?: 'running' | 'completed' | 'failed';
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

  // 子代理面板（嵌入右侧预览区域）
  /** 当前对话的所有子代理列表 */
  subAgents: SubAgentInfo[];
  /** 当前选中查看的子代理 agentId（null 表示不显示子代理面板） */
  selectedSubAgentId: string | null;
  /** 注册一个子代理（运行时创建时调用） */
  registerSubAgent: (info: SubAgentInfo) => void;
  /** 更新子代理状态 */
  updateSubAgentStatus: (agentId: string, status: 'running' | 'completed' | 'failed') => void;
  /** 选中一个子代理查看详情 */
  selectSubAgent: (agentId: string) => void;
  /** 关闭子代理面板（回到正常预览） */
  closeSubAgentPanel: () => void;
  /** 清空子代理列表（切换对话时调用） */
  clearSubAgents: () => void;
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

  // 子代理面板
  subAgents: [],
  selectedSubAgentId: null,
  registerSubAgent: (info) => set((s) => {
    // 防止重复注册
    if (s.subAgents.some(a => a.agentId === info.agentId)) return s;
    return { subAgents: [...s.subAgents, info] };
  }),
  updateSubAgentStatus: (agentId, status) => set((s) => ({
    subAgents: s.subAgents.map(a => a.agentId === agentId ? { ...a, status } : a),
  })),
  selectSubAgent: (agentId) => set({ selectedSubAgentId: agentId }),
  closeSubAgentPanel: () => set({ selectedSubAgentId: null }),
  clearSubAgents: () => set({ subAgents: [], selectedSubAgentId: null }),
}));
