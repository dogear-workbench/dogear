import { mainLogger } from '../../agents/logger.js';
import {
  feishuCardController,
  type CardActionProcessor,
  type CardActionReply,
  type CardActionToast,
} from './feishu-card-controller.js';
import {
  buildConversationListCard,
  buildPendingBindingCard,
  buildTopicListCard,
  buildWorkspaceListCard,
  currentStatusCardData,
  MAX_STATUS_ROWS,
  MANAGE_BACK_ACTION,
  MANAGE_CONV_LIST_ACTION,
  MANAGE_CONV_PICK_ACTION,
  MANAGE_PENDING_CANCEL_ACTION,
  MANAGE_TOPIC_LIST_ACTION,
  MANAGE_TOPIC_PICK_ACTION,
  TOPIC_AUTO_VALUE,
  MANAGE_WS_LIST_ACTION,
  MANAGE_WS_PICK_ACTION,
} from './feishu-status-card.js';
import { feishuThreadService } from './feishu-thread-service.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import * as groupService from '../../services/group-service.js';

const log = mainLogger;

const BINDING_MISSING_TOAST: CardActionToast = { type: 'error', content: '管理卡未关联本群绑定，请重新发送管理卡' };

function routeId(value: Record<string, unknown>, key: string): string | null {
  const v = value[key];
  return typeof v === 'string' && v ? v : null;
}

function listReply(card: object): CardActionReply {
  return { card: { type: 'raw', data: card } };
}

// 回展示态：无绑定时不带 card，只保留 toast
async function statusReply(chatId: string, toast?: CardActionToast): Promise<CardActionReply> {
  const reply: CardActionReply = {};
  if (toast) reply.toast = toast;
  reply.card = (await currentStatusCardData(chatId)) ?? undefined;
  return reply;
}

// 处理器异常兜底：toast error 文案 + 卡片回展示态（计划决策：回调不向用户暴露失败细节）
function safeWrap(processor: CardActionProcessor): CardActionProcessor {
  return async (value, ctx) => {
    try {
      return await processor(value, ctx);
    } catch (err) {
      log.error('[feishu-card-manage] 处理器执行失败:', err);
      const reply: CardActionReply = { toast: { type: 'error', content: '操作失败，请稍后重试' } };
      try {
        if (ctx.chatId) reply.card = (await currentStatusCardData(ctx.chatId)) ?? undefined;
      } catch (cardErr) {
        log.warn(`[feishu-card-manage] 异常兜底回展示态失败: ${String(cardErr)}`);
      }
      return reply;
    }
  };
}

async function requireChatBinding(chatId: string) {
  return feishuThreadService.chatBindings.getByChat(chatId);
}

// 管理卡交互处理器：路由键 manage.*，value 为按钮回传的自定义字段（见 feishu-status-card 构造函数）
export function registerManageCardActions(): void {
  feishuCardController.registerProcessor(MANAGE_WS_LIST_ACTION, safeWrap(async (_value, ctx) => {
    if (!ctx.chatId) return null;
    const workspaces = await workspaceJsonService.getAll();
    if (workspaces.length === 0) {
      return { toast: { type: 'info', content: '暂无工作区，请先在 Dogear 应用内添加' } };
    }
    return listReply(buildWorkspaceListCard(workspaces.map((ws) => ({ id: ws.id, name: ws.name }))));
  }));

  // 切工作区只影响后续新建；groupId 显式清空，旧话题归属不迁移
  feishuCardController.registerProcessor(MANAGE_WS_PICK_ACTION, safeWrap(async (value, ctx) => {
    const chatId = ctx.chatId;
    const workspaceId = routeId(value, 'workspaceId');
    if (!chatId || !workspaceId) return null;
    const workspace = await workspaceJsonService.getById(workspaceId);
    if (!workspace) return { toast: { type: 'error', content: '工作区不存在或已移除' } };
    await feishuThreadService.chatBindings.upsertChat({ chatId, workspaceId, groupId: '' });
    return statusReply(chatId, { type: 'success', content: `已切换工作区：${workspace.name || '未命名工作区'}` });
  }));

  feishuCardController.registerProcessor(MANAGE_TOPIC_LIST_ACTION, safeWrap(async (_value, ctx) => {
    if (!ctx.chatId) return null;
    const chatBinding = await requireChatBinding(ctx.chatId);
    if (!chatBinding) return { toast: BINDING_MISSING_TOAST };
    const groups = (await groupService.listActiveGroups(chatBinding.workspaceId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const rows = groups
      .slice(0, MAX_STATUS_ROWS)
      .map((g) => ({ id: g.id, title: g.title || '未命名话题' }));
    return listReply(buildTopicListCard(rows, groups.length > MAX_STATUS_ROWS));
  }));

  feishuCardController.registerProcessor(MANAGE_TOPIC_PICK_ACTION, safeWrap(async (value, ctx) => {
    const chatId = ctx.chatId;
    const groupId = routeId(value, 'groupId');
    if (!chatId || !groupId) return null;
    const chatBinding = await requireChatBinding(chatId);
    if (!chatBinding) return { toast: BINDING_MISSING_TOAST };
    if (groupId === TOPIC_AUTO_VALUE) {
      await feishuThreadService.chatBindings.upsertChat({ chatId, workspaceId: chatBinding.workspaceId, groupId: '' });
      return statusReply(chatId, { type: 'success', content: '已恢复自动：新会话将在首次新建时自动创建话题' });
    }
    const group = await groupService.getGroup(chatBinding.workspaceId, groupId);
    if (!group) return { toast: { type: 'error', content: '话题不存在或已删除' } };
    await feishuThreadService.chatBindings.upsertChat({ chatId, workspaceId: chatBinding.workspaceId, groupId });
    return statusReply(chatId, { type: 'success', content: `已切换话题：${group.title || '未命名话题'}` });
  }));

  // 只列还没有飞书话题的应用会话：已在话题打开的直接去群里对应话题续聊，不再出现在这里
  feishuCardController.registerProcessor(MANAGE_CONV_LIST_ACTION, safeWrap(async (_value, ctx) => {
    if (!ctx.chatId) return null;
    const chatBinding = await requireChatBinding(ctx.chatId);
    if (!chatBinding) return { toast: BINDING_MISSING_TOAST };
    if (!chatBinding.groupId) {
      return { toast: { type: 'info', content: '本群还没有话题，点击群底部「新建话题」发送消息即可创建' } };
    }
    const conversations = await conversationService.getByGroupId(chatBinding.workspaceId, chatBinding.groupId);
    const boundIds = await feishuThreadService.threadBindings.boundConversationIds();
    const selectable = conversations.filter((conv) => conv.role !== 'sub' && !conv.executor);
    const openable = selectable.filter((conv) => !boundIds.has(conv.id));
    const emptyHint = selectable.length > 0 && openable.length === 0
      ? '当前话题下的会话都已在话题打开，到对应话题继续聊即可'
      : undefined;
    const rows = openable
      .slice(0, MAX_STATUS_ROWS)
      .map((conv) => ({ id: conv.id, title: conv.title || '未命名会话' }));
    return listReply(buildConversationListCard(rows, openable.length > MAX_STATUS_ROWS, emptyHint));
  }));

  feishuCardController.registerProcessor(MANAGE_CONV_PICK_ACTION, safeWrap(async (value, ctx) => {
    const chatId = ctx.chatId;
    const conversationId = routeId(value, 'conversationId');
    if (!chatId || !conversationId) return null;
    const chatBinding = await requireChatBinding(chatId);
    if (!chatBinding) return { toast: BINDING_MISSING_TOAST };
    const conv = await conversationService.getById(chatBinding.workspaceId, conversationId);
    if (!conv) return { toast: { type: 'error', content: '会话不存在或已删除' } };
    const existing = await feishuThreadService.threadBindings.byConversation(chatBinding.workspaceId, conversationId);
    if (existing) {
      return statusReply(chatId, { type: 'info', content: '该会话已在话题打开，到群里对应话题继续聊即可' });
    }
    await feishuThreadService.pendingBindings.set(chatId, chatBinding.workspaceId, conversationId);
    return {
      toast: { type: 'success', content: '已选择会话，点击「新建话题」发送第一条消息即可续聊' },
      card: { type: 'raw', data: buildPendingBindingCard(conv.title || '未命名会话') },
    };
  }));

  // 取消待绑定：清除 pendingBinding，之后新建话题恢复为新建会话
  feishuCardController.registerProcessor(MANAGE_PENDING_CANCEL_ACTION, safeWrap(async (_value, ctx) => {
    if (!ctx.chatId) return null;
    await feishuThreadService.pendingBindings.clear(ctx.chatId);
    return statusReply(ctx.chatId, { type: 'info', content: '已取消待打开，之后新建话题将创建新会话' });
  }));

  feishuCardController.registerProcessor(MANAGE_BACK_ACTION, safeWrap(async (_value, ctx) => {
    if (!ctx.chatId) return null;
    return statusReply(ctx.chatId);
  }));
}
