// electron/main/tipc/wechat.ts
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { wechatAuthService } from '../services/wechat/wechat-auth-service.js';
import { wechatMessageStore } from '../services/wechat/wechat-message-store.js';
import { wechatPoller } from '../services/wechat/wechat-poller.js';
import { wechatILinkService } from '../services/wechat/wechat-ilink-service.js';
import { wechatBotController } from '../services/wechat/wechat-bot-controller.js';
import { getQueryBasedSessionManager } from '../agents/query-based-session.js';
import type { ExtendedSessionMessage } from '../agents/task-types.js';
import type { RendererHandlers } from './renderer-handlers.js';

const t = tipc.create();

// 模块顶层保存监听函数引用，避免重复注册旧监听器
let _sessionMessageHandler: ((sessionId: string, message: ExtendedSessionMessage) => void) | null = null;
let _sessionCompleteHandler: ((sessionId: string, result: any) => Promise<void>) | null = null;
let _remoteActionHandler: ((action: any) => void) | null = null;

// 流式文本 delta 缓冲区：积累当次 query 的 assistant 文本，完成时一次性发送
let _pendingAgentText = '';

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
      // 精确移除 sessionManager 监听器，防止内存泄漏
      const sessionManager = getQueryBasedSessionManager();
      if (_sessionMessageHandler) {
        sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
        _sessionMessageHandler = null;
      }
      if (_sessionCompleteHandler) {
        sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);
        _sessionCompleteHandler = null;
      }
      _pendingAgentText = '';
      // 精确移除 remoteAction 监听器
      if (_remoteActionHandler) {
        wechatBotController.removeListener('remoteAction', _remoteActionHandler);
        _remoteActionHandler = null;
      }
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

      // 注册 remoteAction 事件转发到渲染层（精确移除旧 handler，避免重复注册）
      if (_remoteActionHandler) {
        wechatBotController.removeListener('remoteAction', _remoteActionHandler);
      }
      _remoteActionHandler = (action: any) => {
        handlers.wechatRemoteAction.send(action);
      };
      wechatBotController.on('remoteAction', _remoteActionHandler);

      // 监听 Agent 会话消息，截取最终回复发回微信
      const sessionManager = getQueryBasedSessionManager();

      // 移除旧的监听器
      if (_sessionMessageHandler) sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
      if (_sessionCompleteHandler) sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);

      // 重置缓冲区
      _pendingAgentText = '';

      // 收集流式文本 delta，不立即发送（流式输出每个 token 都会触发一次）
      _sessionMessageHandler = (sessionId: string, message: ExtendedSessionMessage) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;

        // 只积累 assistant 的文本 delta（type='text' 是流式 token，content 是当前 delta 片段）
        if (message.type === 'text' && message.content) {
          _pendingAgentText += message.content;
        }
      };

      // 会话完成时，将积累的文本一次性发送给微信，然后清空缓冲区
      _sessionCompleteHandler = async (sessionId: string, _result: any) => {
        const botState = wechatBotController.getState();
        if (sessionId !== botState.activeSessionId) return;

        const text = _pendingAgentText.trim();
        _pendingAgentText = '';

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
      // 精确移除 sessionManager 监听器，防止内存泄漏
      const sessionManager = getQueryBasedSessionManager();
      if (_sessionMessageHandler) {
        sessionManager.removeListener('sessionMessage', _sessionMessageHandler);
        _sessionMessageHandler = null;
      }
      if (_sessionCompleteHandler) {
        sessionManager.removeListener('sessionComplete', _sessionCompleteHandler);
        _sessionCompleteHandler = null;
      }
      _pendingAgentText = '';
      // 精确移除 remoteAction 监听器
      if (_remoteActionHandler) {
        wechatBotController.removeListener('remoteAction', _remoteActionHandler);
        _remoteActionHandler = null;
      }
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
