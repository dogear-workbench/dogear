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
import { EventEmitter } from 'events';

const log = mainLogger;

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

  private replyContext: { contextToken: string; senderId: string } | null = null;
  private waitingForAgent = false;

  getState(): BotState {
    return { ...this.state };
  }

  async handleIncomingMessage(msg: {
    content: string;
    contextToken: string;
    senderId: string;
    messageType: string;
  }): Promise<void> {
    this.replyContext = {
      contextToken: msg.contextToken,
      senderId: msg.senderId,
    };

    if (msg.messageType !== 'text' || !msg.content.trim()) return;

    const text = msg.content.trim();

    if (text.startsWith('/')) {
      await this.handleCommand(text);
    } else {
      await this.handleAgentMessage(text);
    }
  }

  private async handleCommand(text: string): Promise<void> {
    const spaceIdx = text.indexOf(' ');
    const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    try {
      switch (command) {
        case '/help': await this.cmdHelp(); break;
        case '/status': await this.cmdStatus(); break;
        case '/ws': await this.cmdWorkspace(args); break;
        case '/ls': await this.cmdListConversations(); break;
        case '/use': await this.cmdUseConversation(args); break;
        case '/new': await this.cmdNewConversation(); break;
        case '/stop': await this.cmdStop(); break;
        case '/debug': await this.cmdToggleDebug(); break;
        default:
          await this.reply(`未知命令: ${command}\n输入 /help 查看可用命令`);
      }
    } catch (err: any) {
      log.error(`[bot] 命令执行失败: ${command}`, err);
      await this.reply(`命令执行失败: ${err.message}`);
    }
  }

  private async handleAgentMessage(text: string): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。');
      return;
    }

    this.emit('remoteAction', {
      type: 'sendMessage',
      sessionId: this.state.activeSessionId,
      conversationId: this.state.activeConversationId,
      content: text,
    });

    this.waitingForAgent = true;
  }

  private async cmdHelp(): Promise<void> {
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
    ].join('\n'));
  }

  private async cmdStatus(): Promise<void> {
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
    ].join('\n'));
  }

  private async cmdWorkspace(args: string): Promise<void> {
    const workspaces = await workspaceJsonService.getAll();

    if (!args) {
      if (workspaces.length === 0) {
        await this.reply('没有工作区。请在 Dogear 桌面端创建。');
        return;
      }
      const lines = workspaces.map((ws, i) => {
        const marker = ws.id === this.state.activeWorkspaceId ? ' *' : '';
        return `${i + 1}. ${ws.name}${marker}`;
      });
      await this.reply(['== 工作区列表 ==', ...lines, '', '用 /ws <编号> 切换'].join('\n'));
      return;
    }

    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= workspaces.length) {
      await this.reply(`无效编号。可选: 1-${workspaces.length}`);
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

    await this.reply(`已切换到工作区: ${target.name}`);
  }

  private async cmdListConversations(): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    if (conversations.length === 0) {
      await this.reply('当前工作区没有对话。用 /new 新建。');
      return;
    }

    const lines = conversations.map((conv, i) => {
      const marker = conv.id === this.state.activeConversationId ? ' *' : '';
      const title = conv.title || '未命名对话';
      return `${i + 1}. ${title}${marker}`;
    });

    await this.reply(['== 对话列表 ==', ...lines, '', '用 /use <编号> 选择'].join('\n'));
  }

  private async cmdUseConversation(args: string): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    if (!args) {
      await this.reply('用法: /use <编号>');
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= conversations.length) {
      await this.reply(`无效编号。可选: 1-${conversations.length}`);
      return;
    }

    const target = conversations[idx];
    this.state.activeConversationId = target.id;

    this.emit('remoteAction', {
      type: 'switchConversation',
      workspaceId: this.state.activeWorkspaceId,
      conversationId: target.id,
    });

    await this.reply(`已切换到对话: ${target.title || '未命名对话'}`);
  }

  private async cmdNewConversation(): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    this.emit('remoteAction', {
      type: 'newConversation',
      workspaceId: this.state.activeWorkspaceId,
    });

    await this.reply('正在创建新对话...');
  }

  private async cmdStop(): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有活跃的 Agent 会话');
      return;
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = sessionManager.getSession(this.state.activeSessionId);
    if (session) {
      await session.interrupt();
      this.waitingForAgent = false;
      await this.reply('已中断 Agent');
    } else {
      await this.reply('Agent 会话已不存在');
    }
  }

  private async cmdToggleDebug(): Promise<void> {
    this.state.debugMode = !this.state.debugMode;
    await this.reply(`调试模式: ${this.state.debugMode ? '已开启' : '已关闭'}`);
  }

  async handleAgentReply(text: string): Promise<void> {
    if (!this.waitingForAgent) return;
    this.waitingForAgent = false;
    await this.reply(text);
  }

  async handleAgentComplete(): Promise<void> {
    this.waitingForAgent = false;
  }

  async handlePermissionNotify(toolName: string, sessionId: string): Promise<void> {
    if (!this.state.debugMode) return;
    if (sessionId !== this.state.activeSessionId) return;
    await this.reply(`[Agent 请求权限] 工具: ${toolName}\n请在桌面端确认`);
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

  private async reply(text: string): Promise<void> {
    if (!this.replyContext) {
      log.warn('[bot] 没有回复上下文，无法发送');
      return;
    }

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
            contextToken: this.replyContext.contextToken,
            toUserId: this.replyContext.senderId,
            content: segment,
          },
        );
      } catch (err: any) {
        log.error(`[bot] 回复失败: ${err.message}`);
      }
    }
  }
}

export const wechatBotController = new WechatBotController();
