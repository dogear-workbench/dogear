// electron/main/tipc/wechat.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { wechatAuthService } from '../services/wechat/wechat-auth-service.js';
import { wechatMessageStore } from '../services/wechat/wechat-message-store.js';
import { wechatPoller } from '../services/wechat/wechat-poller.js';
import { wechatILinkService } from '../services/wechat/wechat-ilink-service.js';
import { wechatBotController } from '../services/wechat/wechat-bot-controller.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { RendererHandlers } from './renderer-handlers.js';

import { registerBotStateGetter } from './agent.js';

const t = tipc.create();

// 注册 bot 状态 getter 供 agent.ts 广播层使用（标记 bot 来源的 user 消息）
registerBotStateGetter(() => wechatBotController.getState());

// 模块顶层保存监听函数引用，避免重复注册旧监听器
let _sessionMessageHandler: ((sessionId: string, message: ExtendedSessionMessage) => void) | null = null;
let _sessionCompleteHandler: ((sessionId: string, result: any) => Promise<void>) | null = null;

// 流式文本 delta 缓冲区：按 sessionId 隔离，避免多 session 并行时全局变量竞争
const _pendingAgentTexts: Map<string, string> = new Map();

export const wechatRouter = {
  // === 认证 ===

  /** 获取当前认证状态 */
  'wechat:getAuthStatus': t.procedure.action(async () => {
    try {
      const token = await wechatAuthService.loadToken();
      return {
        data: {
          state: wechatAuthService.getState(),
          botName: token?.botName,
          connectedAt: token?.connectedAt,
          tokenExpiresAt: token?.expiresAt,
        },
      };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 启动 QR 码认证流程 */
  'wechat:startAuth': t.procedure.action(async ({ context }) => {
    try {
      // 注册状态变化回调，推送到渲染层
      const handlers = getRendererHandlers<RendererHandlers>(context.sender);

      const authSender = context.sender;
      // 先移除旧的监听器避免重复
      wechatAuthService.removeAllListeners('stateChange');
      wechatAuthService.on('stateChange', (state: string, botName?: string, errorMessage?: string) => {
        if (!authSender.isDestroyed()) {
          handlers.wechatAuthStatus.send({ state, botName, errorMessage });
        }
      });

      const qrCode = await wechatAuthService.startAuth();
      return { data: qrCode };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 断开连接（停止轮询 + 清除 token） */
  'wechat:disconnect': t.procedure.action(async () => {
    try {
      wechatPoller.stop();
      // 精确移除 sessionManager 监听器，防止内存泄漏
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
      await wechatAuthService.clearToken();
      return { data: { success: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  // === 轮询 ===

  /** 启动长轮询 */
  'wechat:startPolling': t.procedure.action(async ({ context }) => {
    try {
      const token = wechatAuthService.getToken();
      if (!token) {
        return { error: '未认证，请先扫码登录' };
      }

      const handlers = getRendererHandlers<RendererHandlers>(context.sender);

      // 检查微信窗口 WebContents 是否仍然存活
      const sender = context.sender;
      const safeSend = (fn: () => void) => {
        if (!sender.isDestroyed()) fn();
      };

      // 初始化 bot controller（加载默认工作区等）
      await wechatBotController.init();

      // 自动获取 bot 状态和对话列表，推送给前端
      try {
        const autoInitData = await wechatBotController.getAutoInitData();
        safeSend(() => handlers.wechatBotAutoInit.send(autoInitData));
      } catch (err) {
        console.warn('[wechat] 自动初始化数据获取失败:', err);
      }

      // 监听 Agent 会话消息，截取最终回复发回微信
      const sessionManager = getPiSessionManager();

      // 移除旧的监听器
      if (_sessionMessageHandler) sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
      if (_sessionCompleteHandler) sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);

      // 重置缓冲区（清空所有 session 的积累文本）
      _pendingAgentTexts.clear();

      // 收集流式文本 delta，不立即发送（流式输出每个 token 都会触发一次）
      _sessionMessageHandler = (sessionId: string, message: ExtendedSessionMessage) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;

        // 按 sessionId 隔离积累，避免多 session 并行时竞争
        if (message.type === 'text' && message.content) {
          _pendingAgentTexts.set(sessionId, (_pendingAgentTexts.get(sessionId) ?? '') + message.content);
        }

        // debug 模式下权限请求通知微信
        if (message.type === 'permission_request' && message.permissionToolName) {
          wechatBotController.handlePermissionNotify(message.permissionToolName, sessionId).catch(() => {});
        }
      };

      // 会话完成时，将积累的文本一次性发送给微信，然后清空该 session 的缓冲区
      _sessionCompleteHandler = async (sessionId: string, _result: any) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;

        const text = (_pendingAgentTexts.get(sessionId) ?? '').trim();
        _pendingAgentTexts.delete(sessionId);

        if (text) {
          await wechatBotController.handleAgentReply(text);
        }
        await wechatBotController.handleAgentComplete();
      };

      sessionManager.on('sessionMessage', _sessionMessageHandler);
      sessionManager.on('sessionComplete', _sessionCompleteHandler);

      await wechatPoller.start(token.botToken, token.baseUrl, {
        onMessage: async (messages) => {
          // 持久化到 _bot_ 会话
          await wechatMessageStore.appendMessages('_bot_', messages as any[]);
          // 推送到渲染层（仅微信窗口存活时）
          safeSend(() => handlers.wechatNewMessage.send({ messages: messages as any[] }));
          // 每条消息过 bot controller
          for (const msg of messages) {
            await wechatBotController.handleIncomingMessage({
              content: msg.content,
              contextToken: msg.contextToken,
              senderId: msg.senderId,
              messageType: msg.messageType,
            });
          }
        },
        onStatus: (state) => {
          safeSend(() => handlers.wechatConnectionStatus.send({
            polling: state.status === 'polling',
            lastPollAt: state.lastPollAt,
            errorMessage: state.errorMessage,
          }));
        },
        onAuthExpired: () => {
          safeSend(() => handlers.wechatAuthStatus.send({
            state: 'expired',
            errorMessage: 'Token 已过期，请重新扫码',
          }));
        },
      });

      return { data: { started: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 停止轮询 */
  'wechat:stopPolling': t.procedure.action(async () => {
    try {
      wechatPoller.stop();
      // 精确移除 sessionManager 监听器，防止内存泄漏
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
      return { data: { stopped: true } };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 获取连接状态 */
  'wechat:getConnectionStatus': t.procedure.action(async () => {
    try {
      return {
        data: {
          polling: wechatPoller.isRunning(),
          ...wechatPoller.getStatus(),
        },
      };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  // === 联系人和消息 ===

  /** 获取联系人列表 */
  'wechat:getContacts': t.procedure.action(async () => {
    try {
      const contacts = await wechatMessageStore.loadContacts();
      // 按最后消息时间排序（最新在前）
      contacts.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
      return { data: contacts };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  /** 获取指定联系人的消息 */
  'wechat:getMessages': t.procedure
    .input<{ contactId: string; limit?: number; before?: number }>()
    .action(async ({ input }) => {
      try {
        const messages = await wechatMessageStore.loadMessages(
          input.contactId,
          input.limit || 50,
          input.before,
        );
        return { data: messages };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 发送消息 */
  'wechat:sendMessage': t.procedure
    .input<{ contextToken: string; toUserId: string; content: string }>()
    .action(async ({ input }) => {
      try {
        const token = wechatAuthService.getToken();
        if (!token) {
          return { error: '未认证，请先扫码登录' };
        }

        const res = await wechatILinkService.sendMessage(
          token.botToken,
          token.baseUrl,
          {
            contextToken: input.contextToken,
            toUserId: input.toUserId,
            content: input.content,
          },
        );

        if (res.ret !== 0) {
          return { error: `发送失败: ${res.errmsg || `ret=${res.ret}`}` };
        }

        return { data: { success: true } };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 清除联系人未读数 */
  'wechat:clearUnread': t.procedure
    .input<{ contactId: string }>()
    .action(async ({ input }) => {
      try {
        await wechatMessageStore.clearUnread(input.contactId);
        return { data: { success: true } };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  /** 获取 bot 状态和对话列表 */
  'wechat:getBotStatus': t.procedure
    .action(async () => {
      return await wechatBotController.getAutoInitData();
    }),

  /** 通过序号切换 bot 对话 */
  'wechat:botUseConversation': t.procedure
    .input<{ index: number }>()
    .action(async ({ input }) => {
      return await wechatBotController.useConversationByIndex(input.index);
    }),

};
