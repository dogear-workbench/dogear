// electron/main/tipc/digest.ts
// 组级摘要卡 IPC（Phase 3）：列出/读取组卡 + 触发/取消 + 提示词 + 模型选择 + 活动轮询
import { tipc } from '@egoist/tipc/main';
import { listGroupDigests, readGroupDigest } from '../services/memory/group-digest-store.js';
import {
  triggerScanAll, triggerByGroup, getGroupDigestActivity,
} from '../services/memory/group-digest-trigger.js';
import {
  loadGroupDigestPrompt, saveGroupDigestPrompt, DEFAULT_GROUP_DIGEST_PROMPT,
} from '../services/memory/group-digest-prompt.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
import type { ModelSelection } from '../services/settings-types.js';

const t = tipc.create();

export const digestRouter = {
  listGroupDigests: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const digests = await listGroupDigests(input.workspaceId);
        return { digests };
      } catch (error) {
        console.error('[digest] listGroupDigests 失败:', error);
        return { error: String(error) };
      }
    }),

  readGroupDigest: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const card = await readGroupDigest(input.workspaceId, input.groupId);
        return { card };
      } catch (error) {
        console.error('[digest] readGroupDigest 失败:', error);
        return { error: String(error) };
      }
    }),

  triggerGroupDigestScan: t.procedure
    .action(async () => {
      try { await triggerScanAll(); return { success: true }; }
      catch (error) { console.error('[digest] triggerGroupDigestScan 失败:', error); return { error: String(error) }; }
    }),

  triggerGroupDigest: t.procedure
    .input<{ workspaceId: string; workspacePath: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        await triggerByGroup(input.workspaceId, input.workspacePath, input.groupId);
        return { success: true };
      } catch (error) {
        console.error('[digest] triggerGroupDigest 失败:', error);
        return { error: String(error) };
      }
    }),

  getGroupDigestActivity: t.procedure
    .action(async () => {
      try { return { activity: getGroupDigestActivity() }; }
      catch (error) { console.error('[digest] getGroupDigestActivity 失败:', error); return { error: String(error) }; }
    }),

  getGroupDigestPrompt: t.procedure
    .action(async () => {
      try {
        const prompt = await loadGroupDigestPrompt(getConfigDir());
        return { prompt, defaultPrompt: DEFAULT_GROUP_DIGEST_PROMPT };
      } catch (error) {
        console.error('[digest] getGroupDigestPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  setGroupDigestPrompt: t.procedure
    .input<{ prompt: string }>()
    .action(async ({ input }) => {
      try { await saveGroupDigestPrompt(getConfigDir(), input.prompt); return { success: true }; }
      catch (error) { console.error('[digest] setGroupDigestPrompt 失败:', error); return { error: String(error) }; }
    }),

  cancelGroupDigest: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        const { getAgentManager } = await import('../agents/agent-manager.js');
        getAgentManager().cancelTask(input.taskId);
        return { success: true };
      } catch (error) {
        console.error('[digest] cancelGroupDigest 失败:', error);
        return { error: String(error) };
      }
    }),

  // 保留 digestModelSelection 配置项（复用 settings.ai.digestModelSelection）
  getDigestModelSelection: t.procedure
    .action(async () => {
      try { return { selection: (await loadSettings()).ai.digestModelSelection }; }
      catch (error) { console.error('[digest] getDigestModelSelection 失败:', error); return { error: String(error) }; }
    }),
  setDigestModelSelection: t.procedure
    .input<{ selection: ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        const s = await loadSettings();
        s.ai.digestModelSelection = input.selection;
        await saveSettings(s);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestModelSelection 失败:', error);
        return { error: String(error) };
      }
    }),
};
