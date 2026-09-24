import { tipc } from '@egoist/tipc/main';
import { feishuConfigService } from '../services/feishu/feishu-config-service.js';

const t = tipc.create();

export const feishuRouter = {
  'feishu:getConfig': t.procedure.action(async () => {
    try {
      const config = await feishuConfigService.loadConfig();
      return {
        data: {
          configured: !!config,
          appId: config?.appId,
          botName: config?.botName,
          connectedAt: config?.connectedAt,
        },
      };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  'feishu:saveConfig': t.procedure
    .input<{ appId: string; appSecret: string; botName?: string }>()
    .action(async ({ input }) => {
      try {
        if (!input.appId?.trim() || !input.appSecret?.trim()) {
          return { error: 'App ID 和 App Secret 不能为空' };
        }
        await feishuConfigService.saveConfig({
          appId: input.appId.trim(),
          appSecret: input.appSecret.trim(),
          botName: input.botName,
        });
        return { data: { success: true } };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  'feishu:clearConfig': t.procedure.action(async () => {
    try {
      await feishuConfigService.clearConfig();
      return { data: { success: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  'feishu:testConnection': t.procedure
    .input<{ appId?: string; appSecret?: string }>()
    .action(async ({ input }) => {
      try {
        const saved = await feishuConfigService.loadConfig();
        const appId = input.appId?.trim() || saved?.appId;
        const appSecret = input.appSecret?.trim() || saved?.appSecret;
        if (!appId || !appSecret) {
          return { error: '缺少凭证，请先填写 App ID 和 App Secret' };
        }
        return { data: await feishuConfigService.testConnection(appId, appSecret) };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};
