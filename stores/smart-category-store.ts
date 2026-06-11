import { create } from 'zustand';
import { client } from '@/lib/client';
import type { CategorizeActivity, SmartCategory } from '@/types/smart-category';

interface SmartCategoryStore {
  categories: SmartCategory[];
  loading: boolean;
  loadingError: string | null;
  activity: CategorizeActivity | null;
  /** 加载工作区下所有智能分类（后端已过滤归档对话） */
  load: (workspaceId: string) => Promise<void>;
  /** 触发全量重建（清空 + 重决策所有摘要卡） */
  triggerFullRebuild: (workspaceId: string) => Promise<void>;
  /** 取消当前正在跑的任务（全局单队列，无需 workspaceId） */
  cancel: () => Promise<boolean>;
  /** 拉一次活动状态（全局单队列，后端不按 workspaceId 区分） */
  refreshActivity: () => Promise<void>;
  /** 清空 store（切换工作区时调用） */
  reset: () => void;
}

export const useSmartCategoryStore = create<SmartCategoryStore>((set) => ({
  categories: [],
  loading: false,
  loadingError: null,
  activity: null,

  load: async (workspaceId) => {
    set({ loading: true, loadingError: null });
    try {
      const r = await client.getCategories({ workspaceId });
      if (r.error) {
        set({ loading: false, loadingError: r.error });
        return;
      }
      set({ categories: r.categories ?? [], loading: false });
    } catch (e) {
      set({ loading: false, loadingError: String(e) });
    }
  },

  triggerFullRebuild: async (workspaceId) => {
    try {
      await client.triggerFullRebuild({ workspaceId });
    } catch (e) {
      console.warn('[smart-category] triggerFullRebuild 失败:', e);
    }
  },

  cancel: async () => {
    try {
      const r = await client.cancelCategorize();
      return r.cancelled === true;
    } catch (e) {
      console.warn('[smart-category] cancel 失败:', e);
      return false;
    }
  },

  refreshActivity: async () => {
    try {
      const r = await client.getCategorizeActivity();
      if (r.activity) set({ activity: r.activity as CategorizeActivity });
    } catch (e) {
      console.warn('[smart-category] refreshActivity 失败:', e);
    }
  },

  reset: () => set({ categories: [], loading: false, loadingError: null, activity: null }),
}));

// 监听主进程广播：categoriesUpdated → 自动重载受影响工作区的分类
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.categoriesUpdated.listen(async (data) => {
      await useSmartCategoryStore.getState().load(data.workspaceId);
    });
  });
}
