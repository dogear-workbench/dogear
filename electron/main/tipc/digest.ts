// electron/main/tipc/digest.ts
// 会话摘要卡巡检 + 手动提炼 + 提炼模型档位 IPC
import { tipc } from '@egoist/tipc/main';
import { listDigests, readDigest } from '../services/memory/digest-store.js';
import { enqueueDigests } from '../services/memory/digest-trigger.js';
import { loadSettings, saveSettings } from '../services/settings-service.js';

const t = tipc.create();

type DigestModelTier = 'haiku' | 'sonnet' | 'opus';

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

  /** 读取提炼模型档位（缺省 haiku） */
  getDigestModelTier: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { tier: (settings.ai.digestModelTier ?? 'haiku') as DigestModelTier };
      } catch (error) {
        console.error('[digest] getDigestModelTier 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 设置提炼模型档位 */
  setDigestModelTier: t.procedure
    .input<{ tier: DigestModelTier }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.digestModelTier = input.tier;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestModelTier 失败:', error);
        return { error: String(error) };
      }
    }),
};
