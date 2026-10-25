import { create } from 'zustand';

/** 右侧伴随面板 tab 集合 */
export type RightPanelTab = 'files' | 'additional' | 'topic' | 'reading' | 'terminal';

interface UIState {
  // 对话列表开合（rail「对话」项在会话模式再点 toggle；rail 本体恒常驻不可折叠）
  /** 对话列表是否展开 */
  conversationListOpen: boolean;
  /** 切换对话列表开合 */
  toggleConversationList: () => void;
  /** 折叠对话列表 */
  closeConversationList: () => void;

  /** 对话列表当前宽度（运行时态：随设置加载初始化，拖动实时更新，落盘走 settings） */
  conversationListWidth: number;
  setConversationListWidth: (width: number) => void;

  /** 笔记左栏当前宽度（笔记/任务两 mode 共用；模式对齐 conversationListWidth） */
  notesListWidth: number;
  setNotesListWidth: (width: number) => void;

  /** 任务面板左栏当前宽度 */
  tasksListWidth: number;
  setTasksListWidth: (width: number) => void;

  /** 右侧面板当前宽度（CompanionPanel 挂载/拖动时同步，三栏联动判定共享读） */
  rightPanelWidth: number;
  setRightPanelWidth: (width: number) => void;

  // 笔记时间线侧栏折叠（notes/tasks 列表共享；NotesPanel 常驻挂载，跨会话模式切换保留）
  /** 笔记时间线侧栏是否收起 */
  notesListHidden: boolean;
  /** 切换笔记时间线侧栏（rail「笔记」项在笔记模式再点 / Ctrl+\ 同源） */
  toggleNotesListHidden: () => void;

  // 任务面板左栏折叠
  /** 任务面板左栏是否收起 */
  tasksListHidden: boolean;
  /** 切换任务面板左栏（rail「任务」项在任务页再点） */
  toggleTasksListHidden: () => void;

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
  /** 右侧面板当前 tab：文件 / 附加 / 话题 / 阅读 / 终端 */
  rightPanelTab: RightPanelTab;
  /** 切换右侧面板 tab */
  setRightPanelTab: (tab: RightPanelTab) => void;

  // 工作台窗口互斥态（广播驱动，内存态不落盘，重启即单窗口）
  /** 工作台窗口是否开启 */
  workbenchWindowOpen: boolean;
  /** 设置工作台窗口互斥态 */
  setWorkbenchWindowOpen: (open: boolean) => void;

  /** 重置所有状态到初始值 */
  reset: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  // 对话列表（默认展开）
  conversationListOpen: true,
  toggleConversationList: () => set((s) => ({ conversationListOpen: !s.conversationListOpen })),
  closeConversationList: () => set({ conversationListOpen: false }),

  conversationListWidth: 256,
  setConversationListWidth: (width) => set({ conversationListWidth: width }),

  notesListWidth: 300,
  setNotesListWidth: (width) => set({ notesListWidth: width }),

  tasksListWidth: 300,
  setTasksListWidth: (width) => set({ tasksListWidth: width }),

  rightPanelWidth: 384,
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  notesListHidden: false,
  toggleNotesListHidden: () => set((s) => ({ notesListHidden: !s.notesListHidden })),

  tasksListHidden: false,
  toggleTasksListHidden: () => set((s) => ({ tasksListHidden: !s.tasksListHidden })),

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
    conversationListOpen: true,
    conversationListWidth: 256,
    notesListWidth: 300,
    tasksListWidth: 300,
    rightPanelWidth: 384,
    notesListHidden: false,
    tasksListHidden: false,
    rightPanelOpen: false,
    rightPanelTab: 'files',
    workbenchWindowOpen: false,
  }),
}));
