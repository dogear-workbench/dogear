import { create } from 'zustand';

interface UIState {
  // 设置全屏 overlay
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

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
  /** 右侧面板当前 tab：文件 / 附加 / 话题 / 终端 / 浏览器 */
  rightPanelTab: 'files' | 'additional' | 'topic' | 'terminal' | 'browser';
  /** 切换右侧面板 tab */
  setRightPanelTab: (tab: 'files' | 'additional' | 'topic' | 'terminal' | 'browser') => void;

  // 工作台窗口互斥态（广播驱动，内存态不落盘，重启即单窗口）
  /** 工作台窗口是否开启 */
  workbenchWindowOpen: boolean;
  /** 设置工作台窗口互斥态 */
  setWorkbenchWindowOpen: (open: boolean) => void;

  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  // 左侧面板折叠（默认展开）
  leftPanelOpen: true,
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),

  // 右侧预览面板（默认折叠）
  rightPanelOpen: false,
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),

  // 右侧面板 tab（默认文件）
  rightPanelTab: 'files',
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  // 工作台窗口互斥态（默认关闭）
  workbenchWindowOpen: false,
  setWorkbenchWindowOpen: (open) => set({ workbenchWindowOpen: open }),

  reset: () => set({
    settingsOpen: false,
    leftPanelOpen: true,
    rightPanelOpen: false,
    rightPanelTab: 'files',
    workbenchWindowOpen: false,
  }),
}));
