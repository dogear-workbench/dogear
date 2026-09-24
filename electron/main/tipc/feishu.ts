import { tipc } from '@egoist/tipc/main';
import { feishuConfigService } from '../services/feishu/feishu-config-service.js';
import { feishuClientService, logIncomingMessage } from '../services/feishu/feishu-client-service.js';

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

  'feishu:connect': t.procedure.action(async () => {
    try {
      const config = await feishuConfigService.loadConfig();
      if (!config) {
        return { error: '尚未保存飞书凭证，请先填写 App ID 和 App Secret' };
      }
      if (feishuClientService.isRunning()) {
        return { data: { started: true } };
      }
      const res = await feishuClientService.connect(config.appId, config.appSecret, logIncomingMessage);
      if (!res.ok) {
        return { error: res.error };
      }
      return { data: { started: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  'feishu:disconnect': t.procedure.action(async () => {
    try {
      await feishuClientService.disconnect();
      return { data: { stopped: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  'feishu:getConnectionStatus': t.procedure.action(async () => {
    try {
      const config = await feishuConfigService.loadConfig();
      return {
        data: {
          running: feishuClientService.isRunning(),
          ...feishuClientService.getStatus(),
          botName: config?.botName,
          connectedAt: config?.connectedAt,
        },
      };
    } catch (error) {
      return { error: String(error) };
    }
  }),
};
