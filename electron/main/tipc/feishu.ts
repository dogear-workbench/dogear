import electron from 'electron';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { feishuConfigService } from '../services/feishu/feishu-config-service.js';
import { feishuClientService } from '../services/feishu/feishu-client-service.js';
import { feishuBotController } from '../services/feishu/feishu-bot-controller.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { RendererHandlers } from './renderer-handlers.js';
import { registerBotStateGetter } from './agent.js';

const t = tipc.create();
const { shell } = electron;

registerBotStateGetter(() => feishuBotController.getState());

let _sessionMessageHandler: ((sessionId: string, message: ExtendedSessionMessage) => void) | null = null;
let _sessionCompleteHandler: ((sessionId: string, result: any) => Promise<void>) | null = null;

const _pendingAgentTexts: Map<string, string> = new Map();

function handleIncomingMessage(msg: { messageId: string; chatId: string; senderOpenId: string; text: string }): void {
  void feishuBotController.handleIncomingMessage(msg);
}

function attachAgentSessionListeners(): void {
  const sessionManager = getPiSessionManager();
  if (_sessionMessageHandler) sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
  if (_sessionCompleteHandler) sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);
  _pendingAgentTexts.clear();

  _sessionMessageHandler = (sessionId: string, message: ExtendedSessionMessage) => {
    const botState = feishuBotController.getState();
    if (sessionId !== botState.activeSessionId) return;

    if (message.type === 'text' && message.content) {
      _pendingAgentTexts.set(sessionId, (_pendingAgentTexts.get(sessionId) ?? '') + message.content);
    }

    if (message.type === 'permission_request' && message.permissionToolName) {
      feishuBotController.handlePermissionNotify(message.permissionToolName, sessionId).catch(() => {});
    }
  };

  _sessionCompleteHandler = async (sessionId: string, _result: any) => {
    const botState = feishuBotController.getState();
    if (sessionId !== botState.activeSessionId) return;

    const text = (_pendingAgentTexts.get(sessionId) ?? '').trim();
    _pendingAgentTexts.delete(sessionId);

    if (text) {
      await feishuBotController.handleAgentReply(text);
    }
    await feishuBotController.handleAgentComplete();
  };

  sessionManager.on('sessionMessage', _sessionMessageHandler);
  sessionManager.on('sessionComplete', _sessionCompleteHandler);
}

function detachAgentSessionListeners(): void {
  const sessionManager = getPiSessionManager();
  if (_sessionMessageHandler) {
    sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
    _sessionMessageHandler = null;
  }
  if (_sessionCompleteHandler) {
    sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);
    _sessionCompleteHandler = null;
  }
  _pendingAgentTexts.clear();
}

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

  'feishu:connect': t.procedure.action(async ({ context }) => {
    try {
      const config = await feishuConfigService.loadConfig();
      if (!config) {
        return { error: '尚未保存飞书凭证，请先填写 App ID 和 App Secret' };
      }
      if (!feishuClientService.isRunning()) {
        const res = await feishuClientService.connect(config.appId, config.appSecret, handleIncomingMessage);
        if (!res.ok) {
          return { error: res.error };
        }
      }
      await feishuBotController.init();
      attachAgentSessionListeners();
      try {
        const autoInitData = await feishuBotController.getAutoInitData();
        const handlers = getRendererHandlers<RendererHandlers>(context.sender);
        if (!context.sender.isDestroyed()) {
          handlers.feishuBotAutoInit.send(autoInitData);
        }
      } catch (err) {
        console.warn('[feishu] 自动初始化数据获取失败:', err);
      }
      return { data: { started: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  'feishu:disconnect': t.procedure.action(async () => {
    try {
      detachAgentSessionListeners();
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

  'feishu:getBotStatus': t.procedure
    .action(async () => {
      return await feishuBotController.getAutoInitData();
    }),

  'feishu:botUseConversation': t.procedure
    .input<{ index: number }>()
    .action(async ({ input }) => {
      return await feishuBotController.useConversationByIndex(input.index);
    }),

  'feishu:openPlatform': t.procedure
    .input<{ url: string }>()
    .action(async ({ input }) => {
      try {
        if (!input.url.startsWith('https://open.feishu.cn')) {
          return { error: '仅允许打开飞书开放平台链接' };
        }
        await shell.openExternal(input.url);
        return { data: { success: true } };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};

// 主进程启动自动连接：检测到已保存凭证即建常驻 WS，并接好 bot 消息与 Agent 回复链路
export async function autoConnectFeishu(): Promise<void> {
  const cfg = await feishuConfigService.loadConfig();
  if (!cfg) return;
  console.log('[feishu] 检测到已保存凭证，自动连接中...');
  const res = await feishuClientService.connect(cfg.appId, cfg.appSecret, handleIncomingMessage);
  if (!res.ok) {
    console.error('[feishu] 自动连接失败:', res.error);
    return;
  }
  console.log('[feishu] 自动连接成功');
  await feishuBotController.init();
  attachAgentSessionListeners();
}
