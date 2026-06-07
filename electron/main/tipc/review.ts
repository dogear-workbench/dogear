import { tipc } from '@egoist/tipc/main';
import { readReview } from '../services/memory/review-store.js';
import { triggerReview, getReviewActivity } from '../services/memory/review-trigger.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import { loadReviewPrompt, saveReviewPrompt, DEFAULT_REVIEW_PROMPT } from '../services/memory/review-prompt.js';

const t = tipc.create();

type ReviewModelTier = 'haiku' | 'sonnet' | 'opus';

export const reviewRouter = {
  getReviewCard: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const card = await readReview(input.workspaceId);
        return { card };
      } catch (error) {
        console.error('[review] getReviewCard 失败:', error);
        return { error: String(error) };
      }
    }),

  triggerReview: t.procedure
    .input<{ workspaceId: string; workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        triggerReview(input.workspaceId, input.workspacePath);
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

  getReviewModelTier: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { tier: (settings.ai.reviewModelTier ?? 'sonnet') as ReviewModelTier };
      } catch (error) {
        console.error('[review] getReviewModelTier 失败:', error);
        return { error: String(error) };
      }
    }),

  setReviewModelTier: t.procedure
    .input<{ tier: ReviewModelTier }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.reviewModelTier = input.tier;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[review] setReviewModelTier 失败:', error);
        return { error: String(error) };
      }
    }),

  getReviewProfileId: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { profileId: settings.ai.reviewProfileId ?? settings.ai.activeProfileId };
      } catch (error) {
        console.error('[review] getReviewProfileId 失败:', error);
        return { error: String(error) };
      }
    }),

  setReviewProfileId: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.reviewProfileId = input.profileId;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[review] setReviewProfileId 失败:', error);
        return { error: String(error) };
      }
    }),
};
