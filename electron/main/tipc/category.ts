import { tipc } from '@egoist/tipc/main';
import { readIndex } from '../services/memory/smart-category-store.js';
import {
  triggerCategorize,
  triggerFullRebuild,
  cancelCurrent,
  getCategorizeActivity,
} from '../services/memory/category-trigger.js';
import {
  loadCategorizePrompt,
  saveCategorizePrompt,
  DEFAULT_CATEGORIZE_PROMPT,
} from '../services/memory/categorize-prompt.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import { getByWorkspaceId } from '../services/conversation-service.js';
import type { ModelSelection } from '../services/settings-types.js';

const t = tipc.create();

export const categoryRouter = {
  getCategories: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const idx = await readIndex(input.workspaceId);
        const liveConvs = await getByWorkspaceId(input.workspaceId);
        const liveIds = new Set(liveConvs.map((c) => c.id));
        const filteredCategories = idx.categories.map((c) => ({
          ...c,
          groupIds: c.groupIds.filter((id) => liveIds.has(id)),
        }));
        return { categories: filteredCategories };
      } catch (error) {
        console.error('[category] getCategories 失败:', error);
        return { error: String(error) };
      }
    }),

  triggerCategorize: t.procedure
    .input<{ workspaceId: string; groupId: string; groupDigestPath: string }>()
    .action(async ({ input }) => {
      try {
        triggerCategorize(input.workspaceId, input.groupId, input.groupDigestPath);
        return { success: true };
      } catch (error) {
        console.error('[category] triggerCategorize 失败:', error);
        return { error: String(error) };
      }
    }),

  triggerFullRebuild: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        triggerFullRebuild(input.workspaceId);
        return { success: true };
      } catch (error) {
        console.error('[category] triggerFullRebuild 失败:', error);
        return { error: String(error) };
      }
    }),

  cancelCategorize: t.procedure
    .action(async () => {
      try {
        const cancelled = await cancelCurrent();
        return { cancelled };
      } catch (error) {
        console.error('[category] cancelCategorize 失败:', error);
        return { error: String(error) };
      }
    }),

  getCategorizeActivity: t.procedure
    .action(async () => {
      try {
        return { activity: getCategorizeActivity() };
      } catch (error) {
        console.error('[category] getCategorizeActivity 失败:', error);
        return { error: String(error) };
      }
    }),

  getCategorizePrompt: t.procedure
    .action(async () => {
      try {
        const prompt = await loadCategorizePrompt(getConfigDir());
        return { prompt, defaultPrompt: DEFAULT_CATEGORIZE_PROMPT };
      } catch (error) {
        console.error('[category] getCategorizePrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  setCategorizePrompt: t.procedure
    .input<{ prompt: string }>()
    .action(async ({ input }) => {
      try {
        await saveCategorizePrompt(getConfigDir(), input.prompt);
        return { success: true };
      } catch (error) {
        console.error('[category] setCategorizePrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取分类任务专用模型选择（null 时运行时回退到 defaultModelSelection） */
  getCategorizeModelSelection: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { selection: settings.ai.categorizeModelSelection };
      } catch (error) {
        console.error('[category] getCategorizeModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 设置分类任务专用模型选择（传 null 表示清空，回退到默认） */
  setCategorizeModelSelection: t.procedure
    .input<{ selection: ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.categorizeModelSelection = input.selection;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[category] setCategorizeModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  getSmartCategorySettings: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        const sc = settings.smartCategory ?? {};
        return {
          enabled: sc.enabled ?? true,
          threshold: sc.threshold ?? 0.5,
          maxCategories: sc.maxCategories ?? 10,
        };
      } catch (error) {
        console.error('[category] getSmartCategorySettings 失败:', error);
        return { error: String(error) };
      }
    }),

  setSmartCategorySettings: t.procedure
    .input<{ enabled?: boolean; threshold?: number; maxCategories?: number }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        const current = settings.smartCategory ?? { enabled: true, threshold: 0.5, maxCategories: 10 };
        const next = {
          enabled: input.enabled ?? current.enabled,
          threshold:
            input.threshold !== undefined
              ? Math.max(0, Math.min(1, input.threshold))
              : current.threshold,
          maxCategories:
            input.maxCategories !== undefined
              ? Math.max(1, Math.min(50, Math.floor(input.maxCategories)))
              : current.maxCategories,
        };
        settings.smartCategory = next;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[category] setSmartCategorySettings 失败:', error);
        return { error: String(error) };
      }
    }),
};
