import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type {
  ScheduledTask,
  ScheduledTaskWithNextRun,
  SchedulerActivity,
} from '@/types/scheduler';

interface SchedulerStore {
  tasks: ScheduledTaskWithNextRun[];
  loading: boolean;
  loadingError: string | null;
  activity: SchedulerActivity | null;
  loadTasks: () => Promise<void>;
  saveTask: (task: ScheduledTask) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<void>;
  setTaskEnabled: (taskId: string, enabled: boolean) => Promise<void>;
  runTaskNow: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  refreshActivity: () => Promise<void>;
  reset: () => void;
}

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  tasks: [],
  loading: false,
  loadingError: null,
  activity: null,

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

  reset: () => {
    set({
      tasks: [],
      loading: false,
      loadingError: null,
      activity: null,
    });
  },
}));
