import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type {
  Plan,
  PlanWithNextRun,
  RunHistoryEntry,
  SchedulerActivity,
} from '@/types/scheduler';

const ACTIVITY_POLL_MS = 10_000;
const HISTORY_PAGE_SIZE = 50;

interface SchedulerStore {
  plans: PlanWithNextRun[];
  loading: boolean;
  loadingError: string | null;
  activity: SchedulerActivity | null;
  history: RunHistoryEntry[];
  historyPlanId: string | undefined;
  historyCursor: number | undefined;
  historyLoading: boolean;
  historyError: string | null;
  loadingMore: boolean;
  loadPlans: () => Promise<void>;
  savePlan: (plan: Plan) => Promise<boolean>;
  deletePlan: (planId: string) => Promise<void>;
  setPlanEnabled: (planId: string, enabled: boolean) => Promise<void>;
  runNow: (planId: string) => Promise<void>;
  refreshActivity: () => Promise<void>;
  startActivityPolling: () => void;
  stopActivityPolling: () => void;
  loadHistory: (planId?: string) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  reset: () => void;
}

let activityTimer: ReturnType<typeof setInterval> | null = null;
let historySeq = 0;

export const useSchedulerStore = create<SchedulerStore>((set, get) => ({
  plans: [],
  loading: false,
  loadingError: null,
  activity: null,
  history: [],
  historyPlanId: undefined,
  historyCursor: undefined,
  historyLoading: false,
  historyError: null,
  loadingMore: false,

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

  loadHistory: async (planId) => {
    const seq = ++historySeq;
    set({
      historyLoading: true,
      historyError: null,
      historyPlanId: planId,
      historyCursor: undefined,
      loadingMore: false,
    });
    try {
      const r = await client.listRunHistory({ planId, limit: HISTORY_PAGE_SIZE });
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
    const { historyCursor, historyPlanId, historyLoading, loadingMore } = get();
    if (historyLoading || loadingMore || historyCursor === undefined) return;
    set({ loadingMore: true });
    try {
      const r = await client.listRunHistory({
        planId: historyPlanId,
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
    get().stopActivityPolling();
    historySeq++;
    set({
      plans: [],
      loading: false,
      loadingError: null,
      activity: null,
      history: [],
      historyPlanId: undefined,
      historyCursor: undefined,
      historyLoading: false,
      historyError: null,
      loadingMore: false,
    });
  },
}));
