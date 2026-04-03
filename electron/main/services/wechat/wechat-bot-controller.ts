/**
 * 微信 Bot 控制器
 *
 * 消息入口，分两路：
 * - "/" 开头 → 解析斜杠命令 → 调用对应 handler → 回复微信
 * - 普通文本 → 转发给当前激活的 Agent 会话 → 截取最终回复 → 回复微信
 */

import { mainLogger } from '../../agents/logger.js';
import { wechatILinkService } from './wechat-ilink-service.js';
import { wechatAuthService } from './wechat-auth-service.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import { getQueryBasedSessionManager } from '../../agents/query-based-session.js';
import { stripMarkdownForWechat } from './markdown-filter.js';
import { EventEmitter } from 'events';

const log = mainLogger;

// 回复上下文类型，作为参数传递以避免并发竞态
type ReplyCtx = { contextToken: string; senderId: string };

export interface BotState {
  activeWorkspaceId: string | null;
  activeConversationId: string | null;
  activeSessionId: string | null;
  debugMode: boolean;
}

class WechatBotController extends EventEmitter {
  private state: BotState = {
    activeWorkspaceId: null,
    activeConversationId: null,
    activeSessionId: null,
    debugMode: false,
  };

  // 仅供 handleAgentReply / handleAgentComplete / handlePermissionNotify 使用的"最后一个上下文"
  // 不在并发的 handleCommand 调用中修改
  private lastReplyContext: ReplyCtx | null = null;
  private waitingForAgent = false;

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  getState(): BotState {
    return { ...this.state };
  }

  async handleIncomingMessage(msg: {
    content: string;
    contextToken: string;
    senderId: string;
    messageType: string;
  }): Promise<void> {
    // 提取局部上下文，通过参数传递，避免实例字段竞态
    const ctx: ReplyCtx = {
      contextToken: msg.contextToken,
      senderId: msg.senderId,
    };
    // 更新"最后上下文"供 Agent 事件回调使用
    this.lastReplyContext = ctx;

    if (msg.messageType !== 'text' || !msg.content.trim()) return;

    const text = msg.content.trim();

    if (text.startsWith('/')) {
      await this.handleCommand(text, ctx);
    } else {
      this.handleAgentMessage(text, ctx);
    }
  }

  private async handleCommand(text: string, ctx: ReplyCtx): Promise<void> {
    const spaceIdx = text.indexOf(' ');
    const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    try {
      switch (command) {
        case '/help': await this.cmdHelp(ctx); break;
        case '/status': await this.cmdStatus(ctx); break;
        case '/ws': await this.cmdWorkspace(args, ctx); break;
        case '/ls': await this.cmdListConversations(ctx); break;
        case '/use': await this.cmdUseConversation(args, ctx); break;
        case '/new': await this.cmdNewConversation(ctx); break;
        case '/stop': await this.cmdStop(ctx); break;
        case '/debug': await this.cmdToggleDebug(ctx); break;
        default:
          await this.reply(`未知命令: ${command}\n输入 /help 查看可用命令`, ctx);
      }
    } catch (err: unknown) {
      log.error(`[bot] 命令执行失败: ${command}`, err);
      await this.reply(`命令执行失败: ${err instanceof Error ? err.message : String(err)}`, ctx);
    }
  }

  // 直接通过 sessionManager 发消息给 Agent，不依赖渲染层转发
  private handleAgentMessage(text: string, ctx: ReplyCtx): void {
    if (!this.state.activeSessionId) {
      this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。', ctx).catch(
        (err: unknown) => log.error('[bot] 回复失败:', err),
      );
      return;
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = sessionManager.getSession(this.state.activeSessionId);
    if (!session) {
      this.reply('Agent 会话已断开，请重新选择对话: /use <编号>', ctx).catch(
        (err: unknown) => log.error('[bot] 回复失败:', err),
      );
      return;
    }

    this.waitingForAgent = true;
    session.sendMessage(text).catch((err: unknown) => {
      log.error('[bot] 发送消息给 Agent 失败:', err);
      this.waitingForAgent = false;
    });
  }

  private async cmdHelp(ctx: ReplyCtx): Promise<void> {
    await this.reply([
      '== Dogear Bot 命令 ==',
      '/help — 显示此帮助',
      '/status — 当前状态',
      '/ws — 列出工作区',
      '/ws <编号> — 切换工作区',
      '/ls — 列出当前工作区的对话',
      '/use <编号> — 切换到指定对话',
      '/new — 新建对话',
      '/stop — 中断当前 Agent',
      '/debug — 开关调试模式',
      '',
      '直接发送文本 → 转发给当前对话的 Agent',
    ].join('\n'), ctx);
  }

  private async cmdStatus(ctx: ReplyCtx): Promise<void> {
    const ws = this.state.activeWorkspaceId
      ? await workspaceJsonService.getById(this.state.activeWorkspaceId)
      : null;

    let convTitle = '无';
    if (this.state.activeConversationId && this.state.activeWorkspaceId) {
      const conv = await conversationService.getById(
        this.state.activeWorkspaceId,
        this.state.activeConversationId,
      );
      convTitle = conv?.title || '未命名对话';
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = this.state.activeSessionId
      ? sessionManager.getSession(this.state.activeSessionId)
      : null;

    await this.reply([
      '== 当前状态 ==',
      `工作区: ${ws?.name || '未选择'}`,
      `对话: ${convTitle}`,
      `Agent: ${session ? '已连接' : '未连接'}`,
      `调试: ${this.state.debugMode ? '开' : '关'}`,
    ].join('\n'), ctx);
  }

  private async cmdWorkspace(args: string, ctx: ReplyCtx): Promise<void> {
    const workspaces = await workspaceJsonService.getAll();

    if (!args) {
      if (workspaces.length === 0) {
        await this.reply('没有工作区。请在 Dogear 桌面端创建。', ctx);
        return;
      }
      const lines = workspaces.map((ws, i) => {
        const marker = ws.id === this.state.activeWorkspaceId ? ' *' : '';
        return `${i + 1}. ${ws.name}${marker}`;
      });
      await this.reply(['== 工作区列表 ==', ...lines, '', '用 /ws <编号> 切换'].join('\n'), ctx);
      return;
    }

    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= workspaces.length) {
      await this.reply(`无效编号。可选: 1-${workspaces.length}`, ctx);
      return;
    }

    const target = workspaces[idx];
    await workspaceJsonService.setDefault(target.id);
    this.state.activeWorkspaceId = target.id;
    this.state.activeConversationId = null;
    this.state.activeSessionId = null;

    this.emit('remoteAction', {
      type: 'switchWorkspace',
      workspaceId: target.id,
    });

    await this.reply(`已切换到工作区: ${target.name}`, ctx);
  }

  private async cmdListConversations(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    if (conversations.length === 0) {
      await this.reply('当前工作区没有对话。用 /new 新建。', ctx);
      return;
    }

    const lines = conversations.map((conv, i) => {
      const marker = conv.id === this.state.activeConversationId ? ' *' : '';
      const title = conv.title || '未命名对话';
      return `${i + 1}. ${title}${marker}`;
    });

    await this.reply(['== 对话列表 ==', ...lines, '', '用 /use <编号> 选择'].join('\n'), ctx);
  }

  private async cmdUseConversation(args: string, ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    if (!args) {
      await this.reply('用法: /use <编号>', ctx);
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= conversations.length) {
      await this.reply(`无效编号。可选: 1-${conversations.length}`, ctx);
      return;
    }

    const target = conversations[idx];
    this.state.activeConversationId = target.id;

    this.emit('remoteAction', {
      type: 'switchConversation',
      workspaceId: this.state.activeWorkspaceId,
      conversationId: target.id,
    });

    await this.reply(`已切换到对话: ${target.title || '未命名对话'}`, ctx);
  }

  private async cmdNewConversation(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    this.emit('remoteAction', {
      type: 'newConversation',
      workspaceId: this.state.activeWorkspaceId,
    });

    await this.reply('正在创建新对话...', ctx);
  }

  private async cmdStop(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有活跃的 Agent 会话', ctx);
      return;
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = sessionManager.getSession(this.state.activeSessionId);
    if (session) {
      await session.interrupt();
      this.waitingForAgent = false;
      await this.reply('已中断 Agent', ctx);
    } else {
      await this.reply('Agent 会话已不存在', ctx);
    }
  }

  private async cmdToggleDebug(ctx: ReplyCtx): Promise<void> {
    this.state.debugMode = !this.state.debugMode;
    await this.reply(`调试模式: ${this.state.debugMode ? '已开启' : '已关闭'}`, ctx);
  }

  async handleAgentReply(text: string): Promise<void> {
    if (!this.waitingForAgent) return;
    this.waitingForAgent = false;
    if (this.lastReplyContext) {
      await this.reply(stripMarkdownForWechat(text), this.lastReplyContext);
    }
  }

  async handleAgentComplete(): Promise<void> {
    this.waitingForAgent = false;
  }

  async handlePermissionNotify(toolName: string, sessionId: string): Promise<void> {
    if (!this.state.debugMode) return;
    if (sessionId !== this.state.activeSessionId) return;
    if (this.lastReplyContext) {
      await this.reply(`[Agent 请求权限] 工具: ${toolName}\n请在桌面端确认`, this.lastReplyContext);
    }
  }

  updateSessionId(sessionId: string | null): void {
    this.state.activeSessionId = sessionId;
    log.info(`[bot] activeSessionId updated: ${sessionId?.slice(0, 8) || 'null'}`);
  }

  updateConversationId(conversationId: string | null): void {
    this.state.activeConversationId = conversationId;
  }

  async init(): Promise<void> {
    const defaultWs = await workspaceJsonService.getDefault();
    if (defaultWs) {
      this.state.activeWorkspaceId = defaultWs.id;
      log.info(`[bot] 初始化工作区: ${defaultWs.name}`);
    }
  }

  private async reply(text: string, ctx: ReplyCtx): Promise<void> {
    const token = wechatAuthService.getToken();
    if (!token) {
      log.warn('[bot] 未认证，无法回复');
      return;
    }

    const MAX_MSG_LEN = 2000;
    const segments = text.length > MAX_MSG_LEN
      ? Array.from({ length: Math.ceil(text.length / MAX_MSG_LEN) }, (_, i) =>
          text.slice(i * MAX_MSG_LEN, (i + 1) * MAX_MSG_LEN))
      : [text];

    for (const segment of segments) {
      try {
        await wechatILinkService.sendMessage(
          token.botToken,
          token.baseUrl,
          {
            contextToken: ctx.contextToken,
            toUserId: ctx.senderId,
            content: segment,
          },
        );
      } catch (err: unknown) {
        log.error(`[bot] 回复失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

export const wechatBotController = new WechatBotController();
