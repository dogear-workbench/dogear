import { mainLogger } from '../../agents/logger.js';
import { feishuClientService } from './feishu-client-service.js';
import { buildButtonCard, buildCallbackButton, feishuCardKit } from './feishu-cardkit.js';
import { feishuThreadService, PENDING_BINDING_TTL_MINUTES, type FeishuChatBinding } from './feishu-thread-service.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import * as groupService from '../../services/group-service.js';

const log = mainLogger;

export const STATUS_CARD_TITLE = 'Dogear 管理';
const STATUS_CARD_TEMPLATE = 'blue';
export const MAX_STATUS_ROWS = 20;
const NO_GROUP_HINT = '待首次新建会话自动创建';
const EMPTY_LIST_HINT = '暂无会话，点击群底部「新建话题」发送消息即可自动创建';
const LIST_OVERFLOW_HINT = `仅显示最近 ${MAX_STATUS_ROWS} 条，更多会话请到 Dogear 应用内查看`;
const TOPIC_OVERFLOW_HINT = `仅显示最近 ${MAX_STATUS_ROWS} 个话题，更多请到 Dogear 应用内查看`;
const DELETED_CONV_LABEL = '（会话已删除）';
const UNSAVED_CONV_LABEL = '未命名会话';
const UNSAVED_WS_LABEL = '未命名工作区';
const BTN_STYLE = { type: 'default', size: 'medium' } as const;

// 管理卡按钮路由键（与 debug.ping 区分的 manage 前缀）；value 结构见各 build 函数
export const MANAGE_WS_LIST_ACTION = 'manage.ws.list';
export const MANAGE_WS_PICK_ACTION = 'manage.ws.pick';
export const MANAGE_TOPIC_LIST_ACTION = 'manage.topic.list';
export const MANAGE_TOPIC_PICK_ACTION = 'manage.topic.pick';
export const MANAGE_CONV_LIST_ACTION = 'manage.conv.list';
export const MANAGE_CONV_PICK_ACTION = 'manage.conv.pick';
export const MANAGE_PENDING_CANCEL_ACTION = 'manage.pending.cancel';
export const MANAGE_BACK_ACTION = 'manage.back';

// 展示态卡视图数据：名称解析完成后的纯数据，buildStatusCard 只做 JSON 组装
export interface StatusCardView {
  workspaceName: string | null;
  groupTitle: string | null;
  pendingTitle: string | null;
  threadRows: string[];
  overflow: boolean;
}

export function buildStatusCard(view: StatusCardView): object {
  const lines = [
    `**工作区**：${view.workspaceName || '未知'}`,
    `**话题**：${view.groupTitle || NO_GROUP_HINT}`,
  ];
  if (view.pendingTitle) {
    lines.push(`**待打开**：${view.pendingTitle}（点击「新建话题」发送首条消息即续聊，${PENDING_BINDING_TTL_MINUTES} 分钟内有效）`);
  }
  lines.push('', '**会话**');
  if (view.threadRows.length === 0) {
    lines.push(EMPTY_LIST_HINT);
  } else {
    lines.push(...view.threadRows);
    if (view.overflow) lines.push(LIST_OVERFLOW_HINT);
  }
  return buildButtonCard({
    title: STATUS_CARD_TITLE,
    template: STATUS_CARD_TEMPLATE,
    elements: [{ tag: 'markdown', content: lines.join('\n') }],
    buttons: [
      buildCallbackButton('切换工作区', { action: MANAGE_WS_LIST_ACTION }, BTN_STYLE),
      buildCallbackButton('切换话题', { action: MANAGE_TOPIC_LIST_ACTION }, BTN_STYLE),
      buildCallbackButton('打开会话', { action: MANAGE_CONV_LIST_ACTION }, BTN_STYLE),
      ...(view.pendingTitle
        ? [buildCallbackButton('取消待打开', { action: MANAGE_PENDING_CANCEL_ACTION }, BTN_STYLE)]
        : []),
    ],
  });
}

// 顶部返回 + 竖排选项按钮的列表态卡（每行一个选项，value 原样回传给处理器）
function buildListCard(title: string, options: { text: string; value: Record<string, unknown> }[], hint?: string): object {
  const elements: object[] = [buildCallbackButton('返回', { action: MANAGE_BACK_ACTION }, BTN_STYLE)];
  if (hint) elements.push({ tag: 'markdown', content: hint });
  elements.push(...options.map((o) => buildCallbackButton(o.text, o.value, BTN_STYLE)));
  return buildButtonCard({ title, template: STATUS_CARD_TEMPLATE, elements });
}

export function buildWorkspaceListCard(workspaces: { id: string; name: string }[]): object {
  return buildListCard(
    '选择工作区',
    workspaces.map((ws) => ({ text: ws.name || UNSAVED_WS_LABEL, value: { action: MANAGE_WS_PICK_ACTION, workspaceId: ws.id } })),
  );
}

// 首项固定为「自动」：取消已选话题，恢复新建会话时自动建话题
export const TOPIC_AUTO_VALUE = 'auto';

export function buildTopicListCard(groups: { id: string; title: string }[], overflow: boolean): object {
  const options = [
    { text: '自动 · 新建会话时创建话题', value: { action: MANAGE_TOPIC_PICK_ACTION, groupId: TOPIC_AUTO_VALUE } },
    ...groups.map((g) => ({ text: g.title || '未命名话题', value: { action: MANAGE_TOPIC_PICK_ACTION, groupId: g.id } })),
  ];
  return buildListCard('选择话题', options, overflow ? TOPIC_OVERFLOW_HINT : undefined);
}

export function buildConversationListCard(
  conversations: { id: string; title: string }[],
  overflow: boolean,
  emptyHint?: string,
): object {
  const hint = conversations.length === 0 ? emptyHint ?? EMPTY_LIST_HINT : overflow ? LIST_OVERFLOW_HINT : undefined;
  return buildListCard(
    '打开会话',
    conversations.map((c) => ({ text: c.title || UNSAVED_CONV_LABEL, value: { action: MANAGE_CONV_PICK_ACTION, conversationId: c.id } })),
    hint,
  );
}

// 待绑定确认态：引导用户新建话题发首条消息完成续聊；取消即清除待绑定回到展示态
export function buildPendingBindingCard(conversationTitle: string): object {
  return buildButtonCard({
    title: STATUS_CARD_TITLE,
    template: STATUS_CARD_TEMPLATE,
    elements: [{
      tag: 'markdown',
      content: `**已选择会话**：${conversationTitle}\n\n点击群底部「新建话题」，发送第一条消息即可续聊该会话（${PENDING_BINDING_TTL_MINUTES} 分钟内有效）`,
    }],
    buttons: [buildCallbackButton('取消', { action: MANAGE_PENDING_CANCEL_ACTION }, BTN_STYLE)],
  });
}

async function gatherView(chatBinding: FeishuChatBinding): Promise<StatusCardView> {
  const [workspace, group, bindings, pending] = await Promise.all([
    workspaceJsonService.getById(chatBinding.workspaceId),
    chatBinding.groupId
      ? groupService.getGroup(chatBinding.workspaceId, chatBinding.groupId)
      : Promise.resolve(null),
    feishuThreadService.threadBindings.listByChat(chatBinding.chatId),
    feishuThreadService.pendingBindings.peek(chatBinding.chatId),
  ]);
  const sorted = [...bindings].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  const rows = await Promise.all(
    sorted.slice(0, MAX_STATUS_ROWS).map(async (b) => {
      const conv = await conversationService.getById(b.workspaceId, b.conversationId);
      const title = (conv ? conv.title || DELETED_CONV_LABEL : DELETED_CONV_LABEL).replace(/\s+/g, ' ');
      return `- ${title}`;
    }),
  );
  const pendingConv = pending
    ? await conversationService.getById(pending.workspaceId, pending.conversationId)
    : null;
  return {
    workspaceName: workspace?.name ?? null,
    groupTitle: group?.title ?? null,
    pendingTitle: pending ? pendingConv?.title?.replace(/\s+/g, ' ') || DELETED_CONV_LABEL : null,
    threadRows: rows,
    overflow: sorted.length > MAX_STATUS_ROWS,
  };
}

// 回调响应与异常兜底共用：按当前绑定取展示态卡（无绑定返回 null，调用方自行降级为纯 toast）
export async function currentStatusCardData(chatId: string): Promise<{ type: 'raw'; data: object } | null> {
  const chatBinding = await feishuThreadService.chatBindings.getByChat(chatId);
  if (!chatBinding) return null;
  return { type: 'raw', data: buildStatusCard(await gatherView(chatBinding)) };
}

class FeishuStatusCardService {
  private inFlight = new Set<string>();
  private lastSentView = new Map<string, string>();
  private cardSequence = new Map<string, number>();

  // 建群后/自愈路径：重发一张新管理卡（旧卡先取消 Pin）；无 chatBinding 时不发；返回是否落地
  async sendStatusCard(chatId: string): Promise<boolean> {
    if (!feishuClientService.isRunning() || this.inFlight.has(chatId)) return false;
    this.inFlight.add(chatId);
    try {
      const chatBinding = await feishuThreadService.chatBindings.getByChat(chatId);
      if (!chatBinding) return false;
      return await this.dispatchNewCard(chatId, chatBinding);
    } catch (err) {
      log.warn(`[feishu-status-card] 管理卡发送失败: ${String(err)}`);
      return false;
    } finally {
      this.inFlight.delete(chatId);
    }
  }

  // 管理卡更新入口：内容无变化跳过；实体更新失败（含 14 天过期、sequence 冲突）转重发新卡
  async refreshStatusCard(chatId: string): Promise<void> {
    if (!feishuClientService.isRunning() || this.inFlight.has(chatId)) return;
    this.inFlight.add(chatId);
    try {
      const chatBinding = await feishuThreadService.chatBindings.getByChat(chatId);
      if (!chatBinding) return;
      const view = await gatherView(chatBinding);
      const serialized = JSON.stringify(view);
      if (!chatBinding.manageCardId || !chatBinding.manageMessageId) {
        await this.dispatchNewCard(chatId, chatBinding, view);
        return;
      }
      if (this.lastSentView.get(chatId) === serialized) return;
      const sequence = this.cardSequence.get(chatId) ?? 1;
      const updated = await feishuCardKit.updateCard(
        chatBinding.manageCardId,
        buildStatusCard(view),
        sequence,
      );
      if (updated.ok) {
        this.lastSentView.set(chatId, serialized);
        this.cardSequence.set(chatId, sequence + 1);
        return;
      }
      log.warn(`[feishu-status-card] 管理卡更新失败，转重发: ${updated.error}`);
      this.cardSequence.delete(chatId);
      await this.dispatchNewCard(chatId, chatBinding, view);
    } catch (err) {
      log.warn(`[feishu-status-card] 管理卡刷新失败: ${String(err)}`);
    } finally {
      this.inFlight.delete(chatId);
    }
  }

  private async dispatchNewCard(
    chatId: string,
    chatBinding: FeishuChatBinding,
    view?: StatusCardView,
  ): Promise<boolean> {
    const cardView = view ?? (await gatherView(chatBinding));
    if (chatBinding.manageMessageId) {
      const unpinned = await feishuClientService.unpinMessage(chatBinding.manageMessageId);
      if (!unpinned.ok) log.warn(`[feishu-status-card] 管理卡取消 Pin 跳过: ${unpinned.error}`);
    }
    const created = await feishuCardKit.createCard(buildStatusCard(cardView));
    if (!created.ok) {
      log.warn(`[feishu-status-card] 创建管理卡实体失败: ${created.error}`);
      return false;
    }
    const sent = await feishuClientService.createGroupCardMessage(chatId, created.value);
    if (!sent.ok || !sent.messageId) {
      log.warn(`[feishu-status-card] 管理卡消息发送失败: ${sent.error}`);
      return false;
    }
    await feishuThreadService.chatBindings.setManageCard(chatId, {
      manageCardId: created.value,
      manageMessageId: sent.messageId,
    });
    this.lastSentView.set(chatId, JSON.stringify(cardView));
    this.cardSequence.set(chatId, 1);
    const pinned = await feishuClientService.pinMessage(sent.messageId);
    if (!pinned.ok) log.warn(`[feishu-status-card] 管理卡 Pin 跳过: ${pinned.error}`);
    log.info(`[feishu-status-card] 管理卡已就绪: chat=${chatId.slice(-6)} card=${created.value.slice(-6)}`);
    return true;
  }
}

export const feishuStatusCardService = new FeishuStatusCardService();
