// electron/main/tipc/digest.ts
// 会话摘要卡巡检 + 手动提炼 + 提炼模型选择 IPC
import { tipc } from '@egoist/tipc/main';
import { listDigests, readDigest } from '../services/memory/digest-store.js';
import { enqueueDigests, getDigestActivity } from '../services/memory/digest-trigger.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import { loadDigestPrompt, saveDigestPrompt, DEFAULT_DIGEST_PROMPT } from '../services/memory/digest-prompt.js';
import type { ModelSelection } from '../services/settings-types.js';

const t = tipc.create();

export const digestRouter = {
  /** 列出工作区所有摘要卡（摘要信息） */
  listDigests: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const digests = await listDigests(input.workspaceId);
        return { digests };
      } catch (error) {
        console.error('[digest] listDigests 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取单张摘要卡正文 */
  readDigest: t.procedure
    .input<{ workspaceId: string; sessionId: string }>()
    .action(async ({ input }) => {
      try {
        const card = await readDigest(input.workspaceId, input.sessionId);
        return { card };
      } catch (error) {
        console.error('[digest] readDigest 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 手动提炼指定会话（入队，串行后台执行） */
  triggerDigest: t.procedure
    .input<{ workspaceId: string; workspacePath: string; sdkSessionId: string }>()
    .action(async ({ input }) => {
      try {
        enqueueDigests([{
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          sdkSessionId: input.sdkSessionId,
        }]);
        return { success: true };
      } catch (error) {
        console.error('[digest] triggerDigest 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取提炼任务专用模型选择（null 时运行时回退到 defaultModelSelection） */
  getDigestModelSelection: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { selection: settings.ai.digestModelSelection };
      } catch (error) {
        console.error('[digest] getDigestModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 设置提炼任务专用模型选择（传 null 表示清空，回退到默认） */
  setDigestModelSelection: t.procedure
    .input<{ selection: ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.digestModelSelection = input.selection;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取提炼活动状态（前端轮询用） */
  getDigestActivity: t.procedure
    .action(async () => {
      try {
        return { activity: getDigestActivity() };
      } catch (error) {
        console.error('[digest] getDigestActivity 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取提炼提示词模板（缺失返回内置默认并播种） */
  getDigestPrompt: t.procedure
    .action(async () => {
      try {
        const prompt = await loadDigestPrompt(getConfigDir());
        return { prompt, defaultPrompt: DEFAULT_DIGEST_PROMPT };
      } catch (error) {
        console.error('[digest] getDigestPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 保存提炼提示词模板 */
  setDigestPrompt: t.procedure
    .input<{ prompt: string }>()
    .action(async ({ input }) => {
      try {
        await saveDigestPrompt(getConfigDir(), input.prompt);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 取消提炼任务（队列中即时移除；正在跑的中断 query） */
  cancelDigest: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        const { getAgentManager } = await import('../agents/agent-manager.js');
        getAgentManager().cancelTask(input.taskId);
        return { success: true };
      } catch (error) {
        console.error('[digest] cancelDigest 失败:', error);
        return { error: String(error) };
      }
    }),
};
