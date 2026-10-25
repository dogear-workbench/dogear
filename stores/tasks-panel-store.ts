import { create } from 'zustand';

/** 右栏详情选中项：定时任务或协作任务 */
export type TasksPanelSelection =
  | { kind: 'scheduled'; planId: string }
  | { kind: 'collab'; taskId: string };

/** 右栏会话历史：定时任务运行会话 / 协作任务执行会话 */
export interface TasksPanelHistoryView {
  conversationId: string;
  /** 会话归属工作区（运行会话可能不属于当前工作区） */
  workspaceId: string;
  source: 'scheduled' | 'collab';
  /** 所属任务 id */
  taskId: string;
}

interface TasksPanelState {
  selection: TasksPanelSelection | null;
  /** 编辑器二级态：仅 'new' = 新建；既有任务编辑入口 = 点击左栏任务行（selection 驱动），与 selection 互斥 */
  editing: 'new' | null;
  /** 会话历史二级态：与 selection/editing 互斥，切换入口按收口规则清除对方 */
  historyView: TasksPanelHistoryView | null;
  /** 工作区列表快照（page 拉取写入；运行会话工作区解析用） */
  workspaces: Array<{ id: string; name: string; isDefault: boolean }>;

  select: (selection: TasksPanelSelection | null) => void;
  openEditor: (editing: 'new') => void;
  closeEditor: () => void;
  openHistory: (view: TasksPanelHistoryView) => void;
  closeHistory: () => void;
  setWorkspaces: (workspaces: Array<{ id: string; name: string; isDefault: boolean }>) => void;
}

export const useTasksPanelStore = create<TasksPanelState>((set) => ({
  selection: null,
  editing: null,
  historyView: null,
  workspaces: [],

  select: (selection) => set({ selection, historyView: null, editing: null }),
  openEditor: (editing) => set({ editing, selection: null, historyView: null }),
  closeEditor: () => set({ editing: null }),
  openHistory: (historyView) => set({ historyView, editing: null }),
  closeHistory: () => set({ historyView: null }),
  setWorkspaces: (workspaces) => set({ workspaces }),
}));

/** 任务工作区 id 解析：未指定 = 默认工作区（主进程 executeTask 同语义） */
export function resolveTaskWorkspaceId(
  workspaceId: string | undefined,
  workspaces: Array<{ id: string; isDefault: boolean }>,
): string | null {
  if (workspaceId !== undefined) return workspaceId;
  return workspaces.find((w) => w.isDefault)?.id ?? null;
}
