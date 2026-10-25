import { mainLogger } from '../../agents/logger.js';
import { feishuClientService, type FeishuActionResult, type FeishuIncomingMessage } from './feishu-client-service.js';
import { feishuThreadService, type FeishuThreadBinding } from './feishu-thread-service.js';
import { feishuConfigService } from './feishu-config-service.js';
import { feishuCardController, type CardActionReply } from './feishu-card-controller.js';
import { buildButtonCard, buildCallbackButton } from './feishu-cardkit.js';
import { feishuStatusCardService } from './feishu-status-card.js';
import { registerManageCardActions } from './feishu-card-manage.js';
import { FeishuStreamRenderer, type ReplyCtx } from './feishu-stream-renderer.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import * as groupService from '../../services/group-service.js';
import { createConversationWithDefaults, getOrCreateGroupByName } from '../conversation-create-service.js';
import { getPiSessionManager } from '../../agents/pi-session/pi-session-manager.js';
import { conversationRuntimeService } from '../conversation-runtime-service.js';
import { broadcastConversationListChanged } from '../renderer-broadcast.js';
import electron from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';

const log = mainLogger;

export interface FeishuBotState {
  activeWorkspaceId: string | null;
  activeConversationId: string | null;
  activeSessionId: string | null;
  activeAttachmentId: string | null;
  debugMode: boolean;
}

interface ThreadRuntime {
  sessionId: string;
  attachmentId: string;
  workspaceId: string;
  conversationId: string;
}

const FEISHU_P2P_TOPIC_TITLE = '飞书私聊';
const THREAD_NOT_EXIST_CODE = 230019;
const MAX_SEEN_MESSAGE_IDS = 500;
const MAX_CONVERSATION_CHOICES = 10;
const TOPIC_TITLE_MAX_LENGTH = 20;
const DEBUG_CARD_ACTION = 'debug.ping';
const DEBUG_CARD_MD_ID = 'debug_status_md';

function buildDebugCard(statusText: string): object {
  return buildButtonCard({
    title: 'Dogear 回调链路测试',
    template: 'blue',
    elements: [{ tag: 'markdown', content: statusText, element_id: DEBUG_CARD_MD_ID }],
    buttons: [buildCallbackButton('点我测试回调', { action: DEBUG_CARD_ACTION }, { elementId: 'debug_btn' })],
  });
}

function truncateTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > TOPIC_TITLE_MAX_LENGTH ? cleaned.slice(0, TOPIC_TITLE_MAX_LENGTH) + '…' : cleaned;
}

// 供 /ls、/use 与 UI 列表共用的统一口径：仅主会话（排除 agent 派生子会话与任务执行会话），
// 按更新时间倒序取前 N，保证三处编号一致
async function getSelectableConversations(workspaceId: string) {
  const conversations = await conversationService.getByWorkspaceId(workspaceId);
  return conversations
    .filter((conv) => conv.role !== 'sub' && !conv.executor)
    .slice(0, MAX_CONVERSATION_CHOICES);
}

class FeishuBotController {
  private debugCardClicks = 0;

  constructor() {
    // 回调链路自检：点击 /debug card 发出的测试按钮 → toast + 整卡文案变化
    feishuCardController.registerProcessor(DEBUG_CARD_ACTION, async (): Promise<CardActionReply> => {
      const clicks = ++this.debugCardClicks;
      const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      return {
        toast: { type: 'success', content: `回调正常，第 ${clicks} 次点击` },
        card: { type: 'raw', data: buildDebugCard(`✅ 回调链路正常：第 **${clicks}** 次点击（${now}）`) },
      };
    });
    registerManageCardActions();
  }

  private state: FeishuBotState = {
    activeWorkspaceId: null,
    activeConversationId: null,
    activeSessionId: null,
    activeAttachmentId: null,
    debugMode: false,
  };

  private sessionCtx = new Map<string, ReplyCtx>();
  private waitingSessions = new Set<string>();
  // 私聊 /new 懒创建标记：命令只表态，下一条消息到达才真正建会话
  private pendingNewConversation = false;
  private seenMessageIds = new Set<string>();
  private seenMessageIdOrder: string[] = [];
  private threadRuntimes = new Map<string, ThreadRuntime>();
  private renderer = new FeishuStreamRenderer((sid) => this.sessionCtx.get(sid) ?? null);

  getState(): FeishuBotState {
    return { ...this.state };
  }

  async handleIncomingMessage(msg: FeishuIncomingMessage): Promise<void> {
    if (this.isDuplicateMessage(msg.messageId)) return;

    const text = msg.text.trim();
    if (!text) return;

    if (msg.chatType === 'group') {
      if (!msg.threadId) return;
      await this.handleThreadMessage(msg, text);
      return;
    }
    await this.handleP2pMessage(msg, text);
  }

  private async handleP2pMessage(msg: FeishuIncomingMessage, text: string): Promise<void> {
    const ctx: ReplyCtx = {
      messageId: msg.messageId,
      chatId: msg.chatId,
      senderOpenId: msg.senderOpenId,
    };
    await this.recordUserOpenId(msg.senderOpenId);

    if (text.startsWith('/')) {
      await this.handleCommand(text, ctx);
    } else {
      await this.handleAgentMessage(text, ctx);
    }
  }

  private async recordUserOpenId(openId: string): Promise<void> {
    if (!openId) return;
    try {
      const cfg = await feishuConfigService.loadConfig();
      if (!cfg || cfg.userOpenId) return;
      await feishuConfigService.saveConfig({ ...cfg, userOpenId: openId });
      log.info('[feishu-bot] 已记录私聊用户 open_id');
    } catch (err: unknown) {
      log.warn('[feishu-bot] 记录 userOpenId 失败:', err);
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
        case '/debug': await this.cmdDebug(args, ctx); break;
        default:
          await this.reply(`未知命令: ${command}\n输入 /help 查看可用命令`, ctx);
      }
    } catch (err: unknown) {
      log.error(`[feishu-bot] 命令执行失败: ${command}`, err);
      await this.reply(`命令执行失败: ${err instanceof Error ? err.message : String(err)}`, ctx);
    }
  }

  private async handleAgentMessage(text: string, ctx: ReplyCtx): Promise<void> {
    if (this.state.activeSessionId && this.waitingSessions.has(this.state.activeSessionId)) {
      log.warn('[feishu-bot] Agent 正在处理中，忽略重复消息:', text.slice(0, 50));
      this.reply('Agent 正在处理上一条消息，请稍候...', ctx).catch(() => {});
      return;
    }

    if (this.pendingNewConversation) {
      this.pendingNewConversation = false;
      if (!(await this.createPendingConversation(ctx))) return;
    } else if (!this.state.activeSessionId && !(await this.reattachBotSession())) {
      this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。', ctx).catch(
        (err: unknown) => log.error('[feishu-bot] 回复失败:', err),
      );
      return;
    }

    let session = getPiSessionManager().getSession(this.state.activeSessionId!);
    if (!session) {
      if (!(await this.reattachBotSession())) {
        this.reply('Agent 会话已断开，请重新选择对话: /use <编号>', ctx).catch(
          (err: unknown) => log.error('[feishu-bot] 回复失败:', err),
        );
        return;
      }
      session = getPiSessionManager().getSession(this.state.activeSessionId!);
      if (!session) {
        log.error('[feishu-bot] 会话重建后 session 仍不可用');
        return;
      }
    }

    const sessionId = this.state.activeSessionId!;
    this.waitingSessions.add(sessionId);
    this.sessionCtx.set(sessionId, ctx);
    session.sendMessage(text).catch((err: unknown) => {
      log.error('[feishu-bot] 发送消息给 Agent 失败:', err);
      this.waitingSessions.delete(sessionId);
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
      '/new — 新建对话（归入「飞书私聊」话题）',
      '/stop — 中断当前 Agent',
      '/debug — 开关调试模式',
      '/debug card — 发卡片回调链路测试卡',
      '',
      '直接发送文本 → 转发给当前对话的 Agent',
    ].join('\n'), ctx);
  }

  private async cmdStatus(ctx: ReplyCtx): Promise<void> {
    const ws = this.state.activeWorkspaceId
      ? await workspaceJsonService.getById(this.state.activeWorkspaceId)
      : null;

    let convTitle = '无';
    if (this.pendingNewConversation) {
      convTitle = '待新建（发送消息即创建）';
    } else if (this.state.activeConversationId && this.state.activeWorkspaceId) {
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
    this.pendingNewConversation = false;

    await this.reply(`已切换到对话: ${target.title || '未命名对话'}`, ctx);
  }

  private async cmdNewConversation(ctx: ReplyCtx): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws', ctx);
      return;
    }

    this.pendingNewConversation = true;
    if (this.state.activeAttachmentId) {
      conversationRuntimeService.detachAttachment(this.state.activeAttachmentId);
      this.state.activeAttachmentId = null;
      this.state.activeSessionId = null;
      this.state.activeConversationId = null;
    }

    await this.reply('新对话已就绪，发送消息即创建', ctx);
  }

  private async createPendingConversation(ctx: ReplyCtx): Promise<boolean> {
    try {
      const workspaceId = this.state.activeWorkspaceId!;
      const group = await getOrCreateGroupByName(workspaceId, FEISHU_P2P_TOPIC_TITLE);
      const { conversationId } = await createConversationWithDefaults(workspaceId, { groupId: group.id });
      await this.switchBotSession(conversationId);
      broadcastConversationListChanged(this.state.activeWorkspaceId!);
      return true;
    } catch (err: unknown) {
      log.error('[feishu-bot] 懒创建新对话失败:', err);
      await this.reply(`新建对话失败：${err instanceof Error ? err.message : String(err)}`, ctx);
      return false;
    }
  }

  private async reattachBotSession(): Promise<boolean> {
    if (!this.state.activeConversationId) return false;
    try {
      await this.switchBotSession(this.state.activeConversationId);
    } catch (err: unknown) {
      log.error('[feishu-bot] 自动重建会话失败:', err);
      return false;
    }
    return Boolean(this.state.activeSessionId);
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

    if (this.state.activeSessionId && this.state.activeSessionId !== result.sessionId) {
      void this.renderer.finalizeOnly(this.state.activeSessionId, null);
    }

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
      this.waitingSessions.delete(this.state.activeSessionId!);
      await this.reply('已中断 Agent', ctx);
    } else {
      await this.reply('Agent 会话已不存在', ctx);
    }
  }

  private async cmdDebug(args: string, ctx: ReplyCtx): Promise<void> {
    if (args === 'card') {
      await this.sendDebugCard(ctx);
      return;
    }
    await this.cmdToggleDebug(ctx);
  }

  private async cmdToggleDebug(ctx: ReplyCtx): Promise<void> {
    this.state.debugMode = !this.state.debugMode;
    await this.reply(`调试模式: ${this.state.debugMode ? '已开启' : '已关闭'}`, ctx);
  }

  private async sendDebugCard(ctx: ReplyCtx): Promise<void> {
    if (!feishuClientService.isRunning()) {
      await this.reply('飞书未连接，无法发送测试卡', ctx);
      return;
    }
    const res = await feishuClientService.replyCard(
      ctx.messageId,
      buildDebugCard('⏳ 尚未收到回调。点击下方按钮验证回调链路。'),
    );
    if (!res.ok) {
      log.error(`[feishu-bot] 测试卡发送失败: ${res.error}`);
      await this.reply(`测试卡发送失败：${res.error || '未知错误'}`, ctx);
    }
  }

  isBotManagedSession(sessionId: string): boolean {
    if (sessionId === this.state.activeSessionId) return true;
    for (const rt of this.threadRuntimes.values()) {
      if (rt.sessionId === sessionId) return true;
    }
    return false;
  }

  async handleAgentReply(sessionId: string, text: string): Promise<void> {
    if (!this.waitingSessions.has(sessionId)) return;
    this.waitingSessions.delete(sessionId);
    await this.renderer.handleReply(sessionId, text);
  }

  async handleAgentComplete(sessionId: string): Promise<void> {
    this.waitingSessions.delete(sessionId);
  }

  appendAgentChunk(sessionId: string, content: string): void {
    this.renderer.appendChunk(sessionId, content, this.waitingSessions.has(sessionId));
  }

  async abortAllStreams(): Promise<void> {
    await this.renderer.abortAll();
  }

  private async handleThreadMessage(msg: FeishuIncomingMessage, text: string): Promise<void> {
    const threadId = msg.threadId!;
    const ctx: ReplyCtx = {
      messageId: msg.messageId,
      chatId: msg.chatId,
      senderOpenId: msg.senderOpenId,
      threadId,
    };
    await this.handleThreadAgentMessage(threadId, msg, ctx, text);
  }

  // 状态卡「打开会话」后的待绑定消费：新话题首条消息续聊既有会话；
  // 已被其他话题打开或会话已删则提示后回退新建（TTL 由 pendingBindings.consume 内置判断）
  private async consumePendingBinding(
    threadId: string,
    msg: FeishuIncomingMessage,
    ctx: ReplyCtx,
  ): Promise<FeishuThreadBinding | null> {
    const pending = await feishuThreadService.pendingBindings.consume(msg.chatId);
    if (!pending) return null;
    const duplicated = await feishuThreadService.threadBindings.byConversation(
      pending.workspaceId,
      pending.conversationId,
    );
    const conv = duplicated ? null : await conversationService.getById(pending.workspaceId, pending.conversationId);
    if (!conv) {
      await this.replyInThread(
        threadId,
        duplicated ? '该会话已在其他话题打开，本话题将新建会话' : '待打开的会话已不存在，本话题将新建会话',
        ctx,
      );
      return null;
    }
    await feishuThreadService.chatBindings.upsertChat({ chatId: msg.chatId, workspaceId: pending.workspaceId });
    const binding = await feishuThreadService.threadBindings.upsert({
      threadId,
      rootMessageId: msg.rootId || msg.messageId,
      chatId: msg.chatId,
      workspaceId: pending.workspaceId,
      conversationId: pending.conversationId,
    });
    ctx.threadId = threadId;
    ctx.workspaceId = pending.workspaceId;
    ctx.conversationId = pending.conversationId;
    ctx.conversationTitle = conv.title || undefined;
    await this.replyInThread(threadId, `已续聊会话「${conv.title || '未命名会话'}」`, ctx);
    return binding;
  }

  // 懒绑定走群级 chatBinding：群已绑 group 则在其下建会话，否则连 group 一起新建；
  // group 归属不变，所以换话题不再换会话归属，同一群的新建都落在同一话题下
  private async ensureThreadRuntime(
    threadId: string,
    msg: FeishuIncomingMessage,
    ctx: ReplyCtx,
    text: string,
  ): Promise<ThreadRuntime | null> {
    let binding = await feishuThreadService.threadBindings.byThread(threadId);
    if (!binding) binding = await this.consumePendingBinding(threadId, msg, ctx);
    if (!binding) {
      const chatBinding = await feishuThreadService.chatBindings.getByChat(msg.chatId);
      const workspaceId = chatBinding?.workspaceId ?? this.state.activeWorkspaceId;
      if (!workspaceId) {
        await this.replyInThread(threadId, '暂无可用工作区，请先在 Dogear 桌面端选择默认工作区', ctx);
        return null;
      }
      const title = truncateTitle(text) || '新对话';
      const created = chatBinding?.groupId
        ? await createConversationWithDefaults(workspaceId, { groupId: chatBinding.groupId })
        : await createConversationWithDefaults(workspaceId, { title });
      await feishuThreadService.chatBindings.upsertChat({
        chatId: msg.chatId,
        workspaceId,
        groupId: created.groupId,
      });
      broadcastConversationListChanged(workspaceId);
      binding = await feishuThreadService.threadBindings.upsert({
        threadId,
        rootMessageId: msg.rootId || msg.messageId,
        chatId: msg.chatId,
        workspaceId,
        conversationId: created.conversationId,
      });
      ctx.threadId = threadId;
      ctx.workspaceId = workspaceId;
      ctx.conversationId = created.conversationId;
      ctx.conversationTitle = (await conversationService.getById(workspaceId, created.conversationId))?.title;
      await this.replyInThread(threadId, `已绑定会话「${ctx.conversationTitle || title}」`, ctx);
    }

    let rt = this.threadRuntimes.get(threadId);
    if (rt && !getPiSessionManager().getSession(rt.sessionId)) {
      conversationRuntimeService.detachAttachment(rt.attachmentId);
      this.threadRuntimes.delete(threadId);
      rt = undefined;
    }
    if (!rt) {
      try {
        const attached = await conversationRuntimeService.attachConversation(
          binding.conversationId,
          binding.workspaceId,
          'feishu-bot',
        );
        rt = {
          sessionId: attached.sessionId,
          attachmentId: attached.attachmentId,
          workspaceId: binding.workspaceId,
          conversationId: binding.conversationId,
        };
        this.threadRuntimes.set(threadId, rt);
      } catch (err: unknown) {
        log.error('[feishu-bot] 话题会话重建失败:', err);
        await this.replyInThread(threadId, '话题绑定的对话暂不可用，请在桌面端确认对话状态后重试', ctx);
        return null;
      }
    }
    await feishuThreadService.threadBindings.touch(threadId);
    await feishuThreadService.chatBindings.touch(msg.chatId);
    void feishuStatusCardService.refreshStatusCard(msg.chatId);
    return rt;
  }

  private async handleThreadAgentMessage(
    threadId: string,
    msg: FeishuIncomingMessage,
    ctx: ReplyCtx,
    text: string,
  ): Promise<void> {
    const rt = await this.ensureThreadRuntime(threadId, msg, ctx, text);
    if (!rt) return;

    ctx.threadId = threadId;
    ctx.workspaceId = rt.workspaceId;
    ctx.conversationId = rt.conversationId;
    ctx.conversationTitle = (await conversationService.getById(rt.workspaceId, rt.conversationId))?.title;

    const session = getPiSessionManager().getSession(rt.sessionId);
    if (!session) {
      await this.replyInThread(threadId, 'Agent 会话不可用，请稍后重试', ctx);
      return;
    }
    if (this.waitingSessions.has(rt.sessionId)) {
      await this.replyInThread(threadId, 'Agent 正在处理上一条消息，请稍候...', ctx);
      return;
    }

    this.waitingSessions.add(rt.sessionId);
    this.sessionCtx.set(rt.sessionId, ctx);
    session.sendMessage(text).catch((err: unknown) => {
      log.error('[feishu-bot] 发送消息给 Agent 失败:', err);
      this.waitingSessions.delete(rt.sessionId);
    });
  }

  private async replyInThread(threadId: string, text: string, ctx: ReplyCtx): Promise<void> {
    if (ctx.threadId && !ctx.conversationId) {
      const rt = this.threadRuntimes.get(threadId);
      if (rt) {
        ctx.workspaceId = rt.workspaceId;
        ctx.conversationId = rt.conversationId;
        ctx.conversationTitle = (await conversationService.getById(rt.workspaceId, rt.conversationId))?.title;
      }
    }
    const res = await this.reply(text, ctx);
    if (res.ok || res.code !== THREAD_NOT_EXIST_CODE) return;
    await this.reopenThread(threadId, `${text}\n\n（原话题已失效，已自动开启新话题）`);
  }

  private async reopenThread(threadId: string, text: string): Promise<void> {
    const binding = await feishuThreadService.threadBindings.byThread(threadId);
    if (!binding) return;
    const created = await feishuClientService.createGroupMessage(binding.chatId, text);
    if (!created.ok || !created.threadId || !created.messageId) {
      log.warn(`[feishu-bot] 失效话题重开失败: ${created.error}`);
      return;
    }
    const rt = this.threadRuntimes.get(threadId);
    if (rt) {
      this.threadRuntimes.delete(threadId);
      this.threadRuntimes.set(created.threadId, rt);
    }
    await feishuThreadService.threadBindings.upsert({
      threadId: created.threadId,
      rootMessageId: created.messageId,
      chatId: binding.chatId,
      workspaceId: binding.workspaceId,
      conversationId: binding.conversationId,
    });
    await feishuThreadService.threadBindings.remove(threadId);
    log.info(`[feishu-bot] 失效话题已重开: ...${threadId.slice(-6)} -> ...${created.threadId.slice(-6)}`);
  }

  async createTopicChat(): Promise<{ ok: boolean; chatId?: string; error?: string }> {
    if (!feishuClientService.isRunning()) {
      return { ok: false, error: '飞书未连接，请先连接' };
    }
    const cfg = await feishuConfigService.loadConfig();
    if (!cfg) return { ok: false, error: '飞书凭证未配置' };
    if (!cfg.userOpenId) {
      return { ok: false, error: '尚未记录你的用户 ID，请先在飞书私聊机器人发送任意消息后重试' };
    }
    const created = await feishuClientService.createChat('Dogear 话题工作群', cfg.userOpenId);
    if (!created.ok || !created.chatId) return { ok: false, error: created.error };
    // 重建语义：旧面板建过群时，新群落地前清掉旧群三层绑定（旧群若继续使用会在首次活动时自愈重建绑定）
    if (cfg.topicChatId && cfg.topicChatId !== created.chatId) {
      await feishuThreadService.chatBindings.removeByChat(cfg.topicChatId);
      await feishuThreadService.threadBindings.removeByChat(cfg.topicChatId);
      await feishuThreadService.pendingBindings.clear(cfg.topicChatId);
      log.info(`[feishu-bot] 旧话题群绑定已清除: ${cfg.topicChatId}`);
    }
    await feishuConfigService.saveConfig({ ...cfg, topicChatId: created.chatId });
    const workspaceId = this.state.activeWorkspaceId ?? (await workspaceJsonService.getDefault())?.id;
    if (workspaceId) {
      await feishuThreadService.chatBindings.upsertChat({ chatId: created.chatId, workspaceId });
      await feishuStatusCardService.sendStatusCard(created.chatId);
    } else {
      log.warn('[feishu-bot] 话题群已创建但暂无工作区，管理卡将在群内首次活动时补发');
    }
    log.info(`[feishu-bot] 话题工作群已创建: ${created.chatId}`);
    return { ok: true, chatId: created.chatId };
  }

  // 原地重置当前话题工作群：清三层绑定回到初始态并重发管理卡，不建新群；
  // 群内旧话题保留但解绑，再发消息将创建新会话
  async resetTopicChat(): Promise<{ ok: boolean; error?: string }> {
    if (!feishuClientService.isRunning()) {
      return { ok: false, error: '飞书未连接，请先连接' };
    }
    const cfg = await feishuConfigService.loadConfig();
    if (!cfg?.topicChatId) return { ok: false, error: '尚未创建话题工作群' };
    const chatId = cfg.topicChatId;
    const workspaceId = this.state.activeWorkspaceId ?? (await workspaceJsonService.getDefault())?.id;
    if (!workspaceId) return { ok: false, error: '没有可用工作区，无法重置' };
    const old = await feishuThreadService.chatBindings.getByChat(chatId);
    if (old?.manageMessageId) {
      const unpinned = await feishuClientService.unpinMessage(old.manageMessageId);
      if (!unpinned.ok) log.warn(`[feishu-bot] 旧管理卡取消 Pin 跳过: ${unpinned.error}`);
    }
    await feishuThreadService.chatBindings.removeByChat(chatId);
    await feishuThreadService.threadBindings.removeByChat(chatId);
    await feishuThreadService.pendingBindings.clear(chatId);
    await feishuThreadService.chatBindings.upsertChat({ chatId, workspaceId });
    const sent = await feishuStatusCardService.sendStatusCard(chatId);
    if (!sent) {
      return { ok: false, error: '管理卡发送失败，群可能已被删除——请改用「新建群」' };
    }
    log.info(`[feishu-bot] 话题工作群已重置: ${chatId}`);
    return { ok: true };
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

  async handlePermissionNotify(toolName: string, sessionId: string): Promise<void> {
    if (!this.state.debugMode) return;
    if (!this.isBotManagedSession(sessionId)) return;
    const ctx = this.sessionCtx.get(sessionId);
    if (ctx) {
      const text = `[Agent 请求权限] 工具: ${toolName}\n请在桌面端确认`;
      if (ctx.threadId) {
        await this.replyInThread(ctx.threadId, text, ctx);
      } else {
        await this.reply(text, ctx);
      }
    }
  }

  async init(): Promise<void> {
    this.renderer.reset();
    this.threadRuntimes.clear();
    this.waitingSessions.clear();
    const defaultWs = await workspaceJsonService.getDefault();
    if (defaultWs) {
      this.state.activeWorkspaceId = defaultWs.id;
      log.info(`[feishu-bot] 初始化工作区: ${defaultWs.name}`);
    }
  }

  // 类型镜像：rootDir 限制不能跨目录 import types/feishu.ts，与 renderer-handlers.feishuBotAutoInit 保持同步
  async getAutoInitData(): Promise<{
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
      pendingNew: boolean;
    };
    chatBindings: Array<{
      chatId: string;
      workspaceName: string | null;
      groupTitle: string | null;
      hasManageCard: boolean;
      lastActiveAt: string;
      threadBindings: Array<{
        threadId: string;
        conversationTitle: string | null;
        lastActiveAt: string;
      }>;
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
      pendingNew: this.pendingNewConversation,
    };

    const chatBindings = await feishuThreadService.chatBindings.listAll();
    chatBindings.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    const wsNameCache = new Map<string, string | null>();
    const groupTitleCache = new Map<string, string | null>();
    const chatRows = await Promise.all(
      chatBindings.map(async (chatBinding) => {
        let workspaceName = wsNameCache.get(chatBinding.workspaceId);
        if (workspaceName === undefined) {
          workspaceName = (await workspaceJsonService.getById(chatBinding.workspaceId))?.name || null;
          wsNameCache.set(chatBinding.workspaceId, workspaceName);
        }
        const groupCacheKey = `${chatBinding.workspaceId}:${chatBinding.groupId ?? ''}`;
        let groupTitle = groupTitleCache.get(groupCacheKey);
        if (groupTitle === undefined) {
          groupTitle = chatBinding.groupId
            ? (await groupService.getGroup(chatBinding.workspaceId, chatBinding.groupId))?.title || null
            : null;
          groupTitleCache.set(groupCacheKey, groupTitle);
        }
        const threads = await feishuThreadService.threadBindings.listByChat(chatBinding.chatId);
        threads.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
        const threadBindings = await Promise.all(
          threads.map(async (binding) => {
            const conv = await conversationService.getById(binding.workspaceId, binding.conversationId);
            return {
              threadId: binding.threadId,
              conversationTitle: conv ? conv.title || '未命名对话' : null,
              lastActiveAt: binding.lastActiveAt,
            };
          }),
        );
        return {
          chatId: chatBinding.chatId,
          workspaceName,
          groupTitle,
          hasManageCard: Boolean(chatBinding.manageCardId && chatBinding.manageMessageId),
          lastActiveAt: chatBinding.lastActiveAt,
          threadBindings,
        };
      }),
    );

    return { status, chatBindings: chatRows };
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
    this.pendingNewConversation = false;
    return { success: true };
  }


  private async reply(text: string, ctx: ReplyCtx): Promise<FeishuActionResult> {
    try {
      const res = await feishuClientService.replyText(ctx.messageId, text);
      if (!res.ok) log.error(`[feishu-bot] 回复失败: ${res.error}`);
      return res;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[feishu-bot] 回复失败: ${message}`);
      return { ok: false, error: message };
    }
  }
}

export const feishuBotController = new FeishuBotController();
