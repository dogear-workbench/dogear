import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { Plan, PlanWithNextRun, SchedulerActivity } from '@/types/scheduler';

const ACTIVITY_POLL_MS = 10_000;

interface SchedulerStore {
  plans: PlanWithNextRun[];
  loading: boolean;
  loadingError: string | null;
  activity: SchedulerActivity | null;
  loadPlans: () => Promise<void>;
  savePlan: (plan: Plan) => Promise<boolean>;
  deletePlan: (planId: string) => Promise<void>;
  setPlanEnabled: (planId: string, enabled: boolean) => Promise<void>;
  runNow: (planId: string) => Promise<void>;
  refreshActivity: () => Promise<void>;
  startActivityPolling: () => void;
  stopActivityPolling: () => void;
  reset: () => void;
}

let activityTimer: ReturnType<typeof setInterval> | null = null;

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  plans: [],
  loading: false,
  loadingError: null,
  activity: null,

  loadPlans: async () => {
    set({ loading: true, loadingError: null });
    try {
      const r = await client.listPlans();
      if (r.error) {
        set({ loading: false, loadingError: r.error });
        return;
      }
      set({ plans: r.plans ?? [], loading: false });
    } catch (e) {
      set({ loading: false, loadingError: String(e) });
    }
  },

  savePlan: async (plan) => {
    try {
      const r = await client.savePlan({ plan });
      if (!r.ok) {
        toast.error('保存计划失败', { description: r.error });
        return false;
      }
      await get().loadPlans();
      return true;
    } catch (e) {
      toast.error('保存计划失败', { description: String(e) });
      return false;
    }
  },

  deletePlan: async (planId) => {
    try {
      const r = await client.deletePlan({ planId });
      if (!r.ok) {
        toast.error('删除计划失败', { description: r.error });
        return;
      }
      await get().loadPlans();
    } catch (e) {
      toast.error('删除计划失败', { description: String(e) });
    }
  },

  setPlanEnabled: async (planId, enabled) => {
    set({
      plans: get().plans.map((p) => (p.id === planId ? { ...p, enabled } : p)),
    });
    try {
      const r = await client.setPlanEnabled({ planId, enabled });
      if (!r.ok) {
        toast.error(enabled ? '启用计划失败' : '停用计划失败', { description: r.error });
        await get().loadPlans();
      }
    } catch (e) {
      toast.error(enabled ? '启用计划失败' : '停用计划失败', { description: String(e) });
      await get().loadPlans();
    }
  },

  runNow: async (planId) => {
    try {
      const r = await client.runPlanNow({ planId });
      if (r.started) {
        toast.success('计划已开始运行');
        await get().refreshActivity();
        return;
      }
      const act = await client.getSchedulerActivity().catch(() => null);
      if (act?.activity?.running?.some((x) => x.planId === planId)) {
        toast.info('计划正在运行中');
      } else {
        toast.error('无法启动计划', { description: ('error' in r ? r.error : undefined) ?? '计划可能已被删除' });
      }
    } catch (e) {
      toast.error('启动运行失败', { description: String(e) });
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

  startActivityPolling: () => {
    if (activityTimer !== null) return;
    get().refreshActivity();
    activityTimer = setInterval(() => {
      get().refreshActivity();
    }, ACTIVITY_POLL_MS);
  },

  stopActivityPolling: () => {
    if (activityTimer === null) return;
    clearInterval(activityTimer);
    activityTimer = null;
  },

  reset: () => {
    get().stopActivityPolling();
    set({ plans: [], loading: false, loadingError: null, activity: null });
  },
}));
