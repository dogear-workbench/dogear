import { mainLogger } from '../../agents/logger.js';
import { feishuClientService, type FeishuIncomingMessage } from './feishu-client-service.js';
import { markdownToCard } from './feishu-card.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import { getPiSessionManager } from '../../agents/pi-session/pi-session-manager.js';
import { conversationRuntimeService } from '../conversation-runtime-service.js';
import electron from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';

const log = mainLogger;

type ReplyCtx = { messageId: string; chatId: string; senderOpenId: string };

export interface FeishuBotState {
  activeWorkspaceId: string | null;
  activeConversationId: string | null;
  activeSessionId: string | null;
  activeAttachmentId: string | null;
  debugMode: boolean;
}

const MAX_TEXT_LEN = 4000;
const MAX_SEEN_MESSAGE_IDS = 500;
const MAX_CONVERSATION_CHOICES = 10;

// 供 /ls、/use 与 UI 列表共用的统一口径：仅主会话（排除 agent 派生子会话与任务执行会话），
// 按更新时间倒序取前 N，保证三处编号一致
async function getSelectableConversations(workspaceId: string) {
  const conversations = await conversationService.getByWorkspaceId(workspaceId);
  return conversations
    .filter((conv) => conv.role !== 'sub' && !conv.executor)
    .slice(0, MAX_CONVERSATION_CHOICES);
}

class FeishuBotController {
  private state: FeishuBotState = {
    activeWorkspaceId: null,
    activeConversationId: null,
    activeSessionId: null,
    activeAttachmentId: null,
    debugMode: false,
  };

  private lastReplyContext: ReplyCtx | null = null;
  private waitingForAgent = false;
  private seenMessageIds = new Set<string>();
  private seenMessageIdOrder: string[] = [];

  getState(): FeishuBotState {
    return { ...this.state };
  }

  async handleIncomingMessage(msg: FeishuIncomingMessage): Promise<void> {
    if (this.isDuplicateMessage(msg.messageId)) return;

    const ctx: ReplyCtx = {
      messageId: msg.messageId,
      chatId: msg.chatId,
      senderOpenId: msg.senderOpenId,
    };
    this.lastReplyContext = ctx;

    const text = msg.text.trim();
    if (!text) return;

    if (text.startsWith('/')) {
      await this.handleCommand(text, ctx);
    } else {
      this.handleAgentMessage(text, ctx);
    }
  }

  private isDuplicateMessage(messageId: string): boolean {
    if (!messageId) return false;
    if (this.seenMessageIds.has(messageId)) return true;
    this.seenMessageIds.add(messageId);
    this.seenMessageIdOrder.push(messageId);
    if (this.seenMessageIdOrder.length > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageIdOrder.shift();
      if (oldest) this.seenMessageIds.delete(oldest);
    }
    return false;
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
      log.error(`[feishu-bot] 命令执行失败: ${command}`, err);
      await this.reply(`命令执行失败: ${err instanceof Error ? err.message : String(err)}`, ctx);
    }
  }

  private handleAgentMessage(text: string, ctx: ReplyCtx): void {
    if (this.waitingForAgent) {
      log.warn('[feishu-bot] Agent 正在处理中，忽略重复消息:', text.slice(0, 50));
      this.reply('Agent 正在处理上一条消息，请稍候...', ctx).catch(() => {});
      return;
    }

    if (!this.state.activeSessionId) {
      this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。', ctx).catch(
        (err: unknown) => log.error('[feishu-bot] 回复失败:', err),
      );
      return;
    }

    const sessionManager = getPiSessionManager();
    const session = sessionManager.getSession(this.state.activeSessionId);
    if (!session) {
      this.reply('Agent 会话已断开，请重新选择对话: /use <编号>', ctx).catch(
        (err: unknown) => log.error('[feishu-bot] 回复失败:', err),
      );
      return;
    }

    this.waitingForAgent = true;
    session.sendMessage(text).catch((err: unknown) => {
      log.error('[feishu-bot] 发送消息给 Agent 失败:', err);
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

    const sessionManager = getPiSessionManager();
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
    this.state.activeAttachmentId = null;

    await this.reply(`已切换到工作区: ${target.name}`, ctx);
  }

  private async cmdListConversations(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    const conversations = await getSelectableConversations(this.state.activeWorkspaceId);
    if (conversations.length === 0) {
      await this.reply('当前工作区没有对话。用 /new 新建。', ctx);
      return;
    }

    const lines = conversations.map((conv, i) => {
      const marker = conv.id === this.state.activeConversationId ? ' *' : '';
      const title = conv.title || '未命名对话';
      return `${i + 1}. ${title}${marker}`;
    });

    await this.reply(
      ['== 对话列表（最近主会话）==', ...lines, '', '用 /use <编号> 选择'].join('\n'),
      ctx,
    );
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

    const conversations = await getSelectableConversations(this.state.activeWorkspaceId);
    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= conversations.length) {
      await this.reply(`无效编号。可选: 1-${conversations.length}`, ctx);
      return;
    }

    const target = conversations[idx];
    await this.switchBotSession(target.id);

    await this.reply(`已切换到对话: ${target.title || '未命名对话'}`, ctx);
  }

  private async cmdNewConversation(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    const groupService = await import('../group-service.js');
    const newGroup = await groupService.createGroup(this.state.activeWorkspaceId);
    const newConvId = await conversationService.create(this.state.activeWorkspaceId, newGroup.id);
    await this.switchBotSession(newConvId);

    this.broadcastConversationListChanged(this.state.activeWorkspaceId);

    await this.reply('已创建新对话', ctx);
  }

  private async switchBotSession(conversationId: string): Promise<void> {
    if (this.state.activeAttachmentId) {
      conversationRuntimeService.detachAttachment(this.state.activeAttachmentId);
      this.state.activeAttachmentId = null;
      this.state.activeSessionId = null;
      this.state.activeConversationId = null;
    }

    if (!this.state.activeWorkspaceId) {
      log.warn('[feishu-bot] switchBotSession: 没有活跃工作区');
      return;
    }

    const result = await conversationRuntimeService.attachConversation(
      conversationId,
      this.state.activeWorkspaceId,
      'feishu-bot',
    );

    this.state.activeAttachmentId = result.attachmentId;
    this.state.activeSessionId = result.sessionId;
    this.state.activeConversationId = conversationId;

    log.info(`[feishu-bot] 切换到 session: ${result.sessionId.slice(0, 8)}, conv: ${conversationId.slice(0, 8)}, created: ${result.created}`);

    this.broadcastBotBinding(conversationId);
  }

  private async cmdStop(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有活跃的 Agent 会话', ctx);
      return;
    }

    const sessionManager = getPiSessionManager();
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
    const ctx = this.lastReplyContext;
    if (!ctx) return;

    for (const card of markdownToCard(text)) {
      try {
        const res = await feishuClientService.replyCard(ctx.messageId, card);
        if (!res.ok) {
          log.error(`[feishu-bot] 卡片回复失败: ${res.error}`);
        }
      } catch (err: unknown) {
        log.error(`[feishu-bot] 卡片回复失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async handleAgentComplete(): Promise<void> {
    this.waitingForAgent = false;
  }

  private broadcastBotBinding(conversationId: string | null): void {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        const h = getRendererHandlers<RendererHandlers>(win.webContents);
        h.feishuBotBindingChanged.send({ conversationId });
      } catch { /* ignore */ }
    }
  }

  private broadcastConversationListChanged(workspaceId: string): void {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        const h = getRendererHandlers<RendererHandlers>(win.webContents);
        h.conversationListChanged.send({ workspaceId });
      } catch { /* ignore */ }
    }
  }

  async handlePermissionNotify(toolName: string, sessionId: string): Promise<void> {
    if (!this.state.debugMode) return;
    if (sessionId !== this.state.activeSessionId) return;
    if (this.lastReplyContext) {
      await this.reply(`[Agent 请求权限] 工具: ${toolName}\n请在桌面端确认`, this.lastReplyContext);
    }
  }

  async init(): Promise<void> {
    const defaultWs = await workspaceJsonService.getDefault();
    if (defaultWs) {
      this.state.activeWorkspaceId = defaultWs.id;
      log.info(`[feishu-bot] 初始化工作区: ${defaultWs.name}`);
    }
  }

  async getAutoInitData(): Promise<{
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
    };
    conversations: Array<{
      index: number;
      id: string;
      title: string;
      updatedAt: string;
    }>;
  }> {
    const ws = this.state.activeWorkspaceId
      ? await workspaceJsonService.getById(this.state.activeWorkspaceId)
      : null;

    let convTitle: string | null = null;
    if (this.state.activeConversationId && this.state.activeWorkspaceId) {
      const conv = await conversationService.getById(
        this.state.activeWorkspaceId,
        this.state.activeConversationId,
      );
      convTitle = conv?.title || '未命名对话';
    }

    const status = {
      workspaceId: this.state.activeWorkspaceId,
      workspaceName: ws?.name || null,
      conversationId: this.state.activeConversationId,
      conversationTitle: convTitle,
      debugMode: this.state.debugMode,
    };

    let conversations: Array<{ index: number; id: string; title: string; updatedAt: string }> = [];
    if (this.state.activeWorkspaceId) {
      const convList = await getSelectableConversations(this.state.activeWorkspaceId);
      conversations = convList.map((conv, i) => ({
        index: i + 1,
        id: conv.id,
        title: conv.title || '未命名对话',
        updatedAt: conv.updatedAt,
      }));
    }

    return { status, conversations };
  }

  async useConversationByIndex(index: number): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) {
      return { success: false, error: '请先选择工作区' };
    }
    const conversations = await getSelectableConversations(this.state.activeWorkspaceId);
    const idx = index - 1;
    if (idx < 0 || idx >= conversations.length) {
      return { success: false, error: `无效编号。可选: 1-${conversations.length}` };
    }
    const target = conversations[idx];
    await this.switchBotSession(target.id);
    return { success: true };
  }

  private async reply(text: string, ctx: ReplyCtx): Promise<void> {
    const segments = text.length > MAX_TEXT_LEN
      ? Array.from({ length: Math.ceil(text.length / MAX_TEXT_LEN) }, (_, i) =>
          text.slice(i * MAX_TEXT_LEN, (i + 1) * MAX_TEXT_LEN))
      : [text];

    for (const segment of segments) {
      try {
        const res = await feishuClientService.replyText(ctx.messageId, segment);
        if (!res.ok) {
          log.error(`[feishu-bot] 回复失败: ${res.error}`);
        }
      } catch (err: unknown) {
        log.error(`[feishu-bot] 回复失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

export const feishuBotController = new FeishuBotController();
