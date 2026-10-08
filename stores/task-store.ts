import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { ExecProfile, TaskGroups } from '@/types/task';

interface TaskState {
  groups: TaskGroups | null;
  loading: boolean;
  /** 当前已加载的工作区路径，用于惰性加载去重与 tasksChanged 事件匹配 */
  loadedWorkspacePath: string | null;
  /** 当前打开详情的任务 id，null = 停留在列表 */
  activeTaskId: string | null;

  loadTasks: (workspacePath: string) => Promise<void>;
  /** backlog 任务入队执行；成功后立即重拉分组，广播兜底 */
  executeTask: (workspacePath: string, taskId: string) => Promise<string | null>;
  /** backlog 任务手动标记完成（跳过执行） */
  completeTask: (workspacePath: string, taskId: string) => Promise<string | null>;
  /** 排队中/执行中任务取消，回积压 */
  cancelTask: (workspacePath: string, taskId: string) => Promise<string | null>;
  /** 任意状态软删除任务进回收站 */
  deleteTask: (workspacePath: string, taskId: string) => Promise<string | null>;
  /** 计划↔待办流转：plan（含 rejected）→ backlog 或 done → plan */
  moveTask: (workspacePath: string, taskId: string, to: 'backlog' | 'plan') => Promise<string | null>
  /** plan/backlog 任务手动切换执行类型（queued 后不可改） */
  updateExecProfile: (workspacePath: string, taskId: string, execProfile: ExecProfile) => Promise<string | null>;
  /** 监听主进程 tasksChanged 广播，工作区匹配时重新拉取分组；返回取消订阅函数 */
  subscribeTasksChanged: () => () => void;
  setActiveTaskId: (taskId: string | null) => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  groups: null,
  loading: false,
  loadedWorkspacePath: null,
  activeTaskId: null,

  loadTasks: async (workspacePath) => {
    set({ loading: true });
    try {
      const result = await client.listCollabTasks({ workspacePath });
      if ('groups' in result) {
        set({ groups: result.groups, loadedWorkspacePath: workspacePath });
      } else {
        console.error('[tasks] listCollabTasks 失败:', result.error);
      }
    } catch (error) {
      console.error('[tasks] listCollabTasks 失败:', error);
    } finally {
      set({ loading: false });
    }
  },

  executeTask: async (workspacePath, taskId) => {
    try {
      const result = await client.executeCollabTask({ workspacePath, taskId });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] executeCollabTask 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] executeCollabTask 失败:', error);
      return String(error);
    }
  },

  completeTask: async (workspacePath, taskId) => {
    try {
      const result = await client.completeCollabTask({ workspacePath, taskId });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] completeCollabTask 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] completeCollabTask 失败:', error);
      return String(error);
    }
  },

  cancelTask: async (workspacePath, taskId) => {
    try {
      const result = await client.cancelCollabTask({ workspacePath, taskId });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] cancelCollabTask 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] cancelCollabTask 失败:', error);
      return String(error);
    }
  },

  deleteTask: async (workspacePath, taskId) => {
    try {
      const result = await client.deleteCollabTask({ workspacePath, taskId });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] deleteCollabTask 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] deleteCollabTask 失败:', error);
      return String(error);
    }
  },

  moveTask: async (workspacePath, taskId, to) => {
    try {
      const result = await client.moveCollabTask({ workspacePath, taskId, to });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] moveCollabTask 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] moveCollabTask 失败:', error);
      return String(error);
    }
  },

  updateExecProfile: async (workspacePath, taskId, execProfile) => {
    try {
      const result = await client.updateCollabTaskExecProfile({ workspacePath, taskId, execProfile });
      if ('task' in result) {
        await get().loadTasks(workspacePath);
        return null;
      }
      console.error('[tasks] updateCollabTaskExecProfile 失败:', result.error);
      return result.error;
    } catch (error) {
      console.error('[tasks] updateCollabTaskExecProfile 失败:', error);
      return String(error);
    }
  },

  subscribeTasksChanged: () => {
    const unsub = rendererEvents.tasksChanged.listen((data) => {
      const { loadedWorkspacePath, loadTasks } = get();
      if (loadedWorkspacePath && data.workspacePath === loadedWorkspacePath) {
        void loadTasks(loadedWorkspacePath);
      }
    });
    return () => unsub();
  },

  setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),
}));
