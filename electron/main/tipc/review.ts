import { tipc } from '@egoist/tipc/main';
import { readReport } from '../services/memory/review-store.js';
import { triggerReview, getReviewActivity } from '../services/memory/review-trigger.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import { loadReviewPrompt, saveReviewPrompt, DEFAULT_REVIEW_PROMPT } from '../services/memory/review-prompt.js';
import type { ModelSelection } from '../services/settings-types.js';

const t = tipc.create();

export const reviewRouter = {
  getReport: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const report = await readReport(input.workspaceId);
        return { report };
      } catch (error) {
        console.error('[review] getReport 失败:', error);
        return { error: String(error) };
      }
    }),

  triggerReview: t.procedure
    .input<{ workspaceId: string; workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        await triggerReview(input.workspaceId, input.workspacePath);
        return { success: true };
      } catch (error) {
        console.error('[review] triggerReview 失败:', error);
        return { error: String(error) };
      }
    }),

  getReviewActivity: t.procedure
    .action(async () => {
      try {
        return { activity: getReviewActivity() };
      } catch (error) {
        console.error('[review] getReviewActivity 失败:', error);
        return { error: String(error) };
      }
    }),

  getReviewPrompt: t.procedure
    .action(async () => {
      try {
        const prompt = await loadReviewPrompt(getConfigDir());
        return { prompt, defaultPrompt: DEFAULT_REVIEW_PROMPT };
      } catch (error) {
        console.error('[review] getReviewPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  setReviewPrompt: t.procedure
    .input<{ prompt: string }>()
    .action(async ({ input }) => {
      try {
        await saveReviewPrompt(getConfigDir(), input.prompt);
        return { success: true };
      } catch (error) {
        console.error('[review] setReviewPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取复盘任务专用模型选择（null 时运行时回退到 defaultModelSelection） */
  getReviewModelSelection: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { selection: settings.ai.reviewModelSelection };
      } catch (error) {
        console.error('[review] getReviewModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 设置复盘任务专用模型选择（传 null 表示清空，回退到默认） */
  setReviewModelSelection: t.procedure
    .input<{ selection: ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.reviewModelSelection = input.selection;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[review] setReviewModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  cancelReview: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        const { getAgentManager } = await import('../agents/agent-manager.js');
        getAgentManager().cancelTask(input.taskId);
        return { success: true };
      } catch (error) {
        console.error('[review] cancelReview 失败:', error);
        return { error: String(error) };
      }
    }),
};
