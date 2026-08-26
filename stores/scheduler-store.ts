import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type {
  RunHistoryEntry,
  ScheduledTask,
  ScheduledTaskWithNextRun,
  SchedulerActivity,
} from '@/types/scheduler';

const HISTORY_PAGE_SIZE = 50;

interface SchedulerStore {
  tasks: ScheduledTaskWithNextRun[];
  loading: boolean;
  loadingError: string | null;
  activity: SchedulerActivity | null;
  history: RunHistoryEntry[];
  historyTaskId: string | undefined;
  historyCursor: number | undefined;
  historyLoading: boolean;
  historyError: string | null;
  loadingMore: boolean;
  loadTasks: () => Promise<void>;
  saveTask: (task: ScheduledTask) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<void>;
  setTaskEnabled: (taskId: string, enabled: boolean) => Promise<void>;
  runTaskNow: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  refreshActivity: () => Promise<void>;
  loadHistory: (taskId?: string) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  reset: () => void;
}

let historySeq = 0;

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  tasks: [],
  loading: false,
  loadingError: null,
  activity: null,
  history: [],
  historyTaskId: undefined,
  historyCursor: undefined,
  historyLoading: false,
  historyError: null,
  loadingMore: false,

  loadTasks: async () => {
    set({ loading: true, loadingError: null });
    try {
      const r = await client.listTasks();
      if (r.error) {
        set({ loading: false, loadingError: r.error });
        return;
      }
      set({ tasks: r.tasks ?? [], loading: false });
    } catch (e) {
      set({ loading: false, loadingError: String(e) });
    }
  },

  saveTask: async (task) => {
    try {
      const r = await client.saveTask({ task });
      if (!r.ok) {
        toast.error('保存任务失败', { description: r.error });
        return false;
      }
      await get().loadTasks();
      return true;
    } catch (e) {
      toast.error('保存任务失败', { description: String(e) });
      return false;
    }
  },

  deleteTask: async (taskId) => {
    try {
      const r = await client.deleteTask({ taskId });
      if (!r.ok) {
        toast.error('删除任务失败', { description: r.error });
        return;
      }
      await get().loadTasks();
    } catch (e) {
      toast.error('删除任务失败', { description: String(e) });
    }
  },

  setTaskEnabled: async (taskId, enabled) => {
    set({
      tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, enabled } : t)),
    });
    try {
      const r = await client.setTaskEnabled({ taskId, enabled });
      if (!r.ok) {
        toast.error(enabled ? '启用任务失败' : '停用任务失败', { description: r.error });
        await get().loadTasks();
      }
    } catch (e) {
      toast.error(enabled ? '启用任务失败' : '停用任务失败', { description: String(e) });
      await get().loadTasks();
    }
  },

  runTaskNow: async (taskId) => {
    try {
      const r = await client.runTaskNow({ taskId });
      if (r.started) {
        toast.success('任务已开始运行');
        await get().refreshActivity();
        return;
      }
      const act = await client.getSchedulerActivity().catch(() => null);
      if (act?.activity?.running?.some((x) => x.taskId === taskId)) {
        toast.info('任务正在运行中');
      } else {
        toast.error('无法启动任务', { description: ('error' in r ? r.error : undefined) ?? '任务可能已被删除' });
      }
    } catch (e) {
      toast.error('启动运行失败', { description: String(e) });
    }
  },

  stopTask: async (taskId) => {
    try {
      const r = await client.stopTask({ taskId });
      if (!r.ok) {
        toast.error('停止任务失败', { description: r.error });
        return;
      }
      await get().refreshActivity();
    } catch (e) {
      toast.error('停止任务失败', { description: String(e) });
    }
  },

  refreshActivity: async () => {
    try {
      const r = await client.getSchedulerActivity();
      if (r.activity) set({ activity: r.activity });
    } catch (e) {
      console.warn('[scheduler] refreshActivity 失败:', e);
    }
  },

  loadHistory: async (taskId) => {
    const seq = ++historySeq;
    set({
      historyLoading: true,
      historyError: null,
      historyTaskId: taskId,
      historyCursor: undefined,
      loadingMore: false,
    });
    try {
      const r = await client.listRunHistory({ planId: taskId, limit: HISTORY_PAGE_SIZE });
      if (seq !== historySeq) return;
      if ('error' in r) {
        set({ historyLoading: false, historyError: r.error, history: [] });
        return;
      }
      set({ history: r.entries, historyCursor: r.nextCursor, historyLoading: false });
    } catch (e) {
      if (seq !== historySeq) return;
      set({ historyLoading: false, historyError: String(e), history: [] });
    }
  },

  loadMoreHistory: async () => {
    const { historyCursor, historyTaskId, historyLoading, loadingMore } = get();
    if (historyLoading || loadingMore || historyCursor === undefined) return;
    set({ loadingMore: true });
    try {
      const r = await client.listRunHistory({
        planId: historyTaskId,
        cursor: historyCursor,
        limit: HISTORY_PAGE_SIZE,
      });
      if ('error' in r) {
        set({ loadingMore: false });
        toast.error('加载更多历史失败', { description: r.error });
        return;
      }
      set({
        history: [...get().history, ...r.entries],
        historyCursor: r.nextCursor,
        loadingMore: false,
      });
    } catch (e) {
      set({ loadingMore: false });
      toast.error('加载更多历史失败', { description: String(e) });
    }
  },

  reset: () => {
    historySeq++;
    set({
      tasks: [],
      loading: false,
      loadingError: null,
      activity: null,
      history: [],
      historyTaskId: undefined,
      historyCursor: undefined,
      historyLoading: false,
      historyError: null,
      loadingMore: false,
    });
  },
}));
