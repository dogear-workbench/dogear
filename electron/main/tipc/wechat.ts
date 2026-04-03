// electron/main/tipc/wechat.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { wechatAuthService } from '../services/wechat/wechat-auth-service.js';
import { wechatMessageStore } from '../services/wechat/wechat-message-store.js';
import { wechatPoller } from '../services/wechat/wechat-poller.js';
import { wechatILinkService } from '../services/wechat/wechat-ilink-service.js';
import { wechatBotController } from '../services/wechat/wechat-bot-controller.js';
import { getQueryBasedSessionManager } from '../agents/query-based-session.js';
import type { RendererHandlers } from './renderer-handlers.js';

const t = tipc.create();

// 模块顶层保存监听函数引用，避免重复注册旧监听器
let _sessionMessageHandler: ((sessionId: string, message: any) => Promise<void>) | null = null;
let _sessionCompleteHandler: ((sessionId: string) => Promise<void>) | null = null;

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

      // 先移除旧的监听器避免重复
      wechatAuthService.removeAllListeners('stateChange');
      wechatAuthService.on('stateChange', (state: string, botName?: string, errorMessage?: string) => {
        handlers.wechatAuthStatus.send({
          state,
          botName,
          errorMessage,
        });
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

      // 初始化 bot controller（加载默认工作区等）
      await wechatBotController.init();

      // 注册 remoteAction 事件转发到渲染层（避免重复注册）
      wechatBotController.removeAllListeners('remoteAction');
      wechatBotController.on('remoteAction', (action: any) => {
        handlers.wechatRemoteAction.send(action);
      });

      // 监听 Agent 会话消息，截取最终回复发回微信
      const sessionManager = getQueryBasedSessionManager();

      // 移除旧的监听器
      if (_sessionMessageHandler) sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
      if (_sessionCompleteHandler) sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);

      _sessionMessageHandler = async (sessionId: string, message: any) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;
        if (message.role !== 'assistant') return;

        // 提取文本内容
        let text = '';
        if (typeof message.content === 'string') {
          text = message.content;
        } else if (Array.isArray(message.content)) {
          text = message.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text as string)
            .join('\n');
        }
        if (text.trim()) await wechatBotController.handleAgentReply(text.trim());
      };

      _sessionCompleteHandler = async (sessionId: string) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;
        await wechatBotController.handleAgentComplete();
      };

      sessionManager.on('sessionMessage', _sessionMessageHandler);
      sessionManager.on('sessionComplete', _sessionCompleteHandler);

      await wechatPoller.start(token.botToken, token.baseUrl, {
        onMessage: async (messages) => {
          // 持久化到 _bot_ 会话
          await wechatMessageStore.appendMessages('_bot_', messages as any[]);
          // 推送到渲染层（微信窗口展示）
          handlers.wechatNewMessage.send({ messages: messages as any[] });
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
          handlers.wechatConnectionStatus.send({
            polling: state.status === 'polling',
            lastPollAt: state.lastPollAt,
            errorMessage: state.errorMessage,
          });
        },
        onAuthExpired: () => {
          handlers.wechatAuthStatus.send({
            state: 'expired',
            errorMessage: 'Token 已过期，请重新扫码',
          });
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

  /** 渲染层同步当前活跃的 session 给 bot controller */
  'wechat:syncSession': t.procedure
    .input<{ sessionId: string | null; conversationId: string | null }>()
    .action(async ({ input }) => {
      try {
        wechatBotController.updateSessionId(input.sessionId);
        wechatBotController.updateConversationId(input.conversationId);
        return { data: { success: true } };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};
