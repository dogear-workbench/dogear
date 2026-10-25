import { mainLogger } from '../../agents/logger.js';

const log = mainLogger;

// 平台要求 card.action.trigger 回调 3 秒内响应，超时会重推；
// 处理器超预算时先回空响应（无 toast / 不更新卡片），处理器副作用继续在后台完成
const HANDLER_TIMEOUT_MS = 2500;

export type CardToastType = 'info' | 'success' | 'error' | 'warning';

export interface CardActionToast {
  type?: CardToastType;
  content?: string;
  i18n?: Record<string, string>;
}

// 回调同步响应体：toast 提示 + 整卡替换（card.type=raw 须与原卡片同 schema）
export interface CardActionReply {
  toast?: CardActionToast;
  card?: { type: 'raw'; data: object };
}

export interface CardActionContext {
  chatId?: string;
  messageId?: string;
  operatorOpenId?: string;
}

export type CardActionProcessor = (
  value: Record<string, unknown>,
  ctx: CardActionContext,
) => Promise<CardActionReply | null>;

// card.action.trigger 事件经 EventDispatcher.parse 后的展平结构（v2 schema 下 header/event 字段上提）
export interface CardActionTriggerData {
  action?: { value?: Record<string, unknown>; tag?: string; name?: string };
  operator?: { open_id?: string; user_id?: string };
  context?: { open_chat_id?: string; open_message_id?: string; thread_id?: string };
}

// 按钮卡片回调 value 的路由字段约定：value.action 指向注册的处理器名
export const CARD_ACTION_ROUTE_KEY = 'action';

function withTimeout(p: Promise<CardActionReply | null>): Promise<CardActionReply | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.warn('[feishu-card] 处理器超时，已先回空响应');
      resolve(null);
    }, HANDLER_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        log.error('[feishu-card] 处理器执行失败:', err);
        resolve(null);
      },
    );
  });
}

class FeishuCardController {
  private processors = new Map<string, CardActionProcessor>();

  registerProcessor(action: string, processor: CardActionProcessor): void {
    this.processors.set(action, processor);
  }

  async handleAction(data: CardActionTriggerData): Promise<CardActionReply | null> {
    try {
      const value = data.action?.value;
      const route = typeof value?.[CARD_ACTION_ROUTE_KEY] === 'string' ? value[CARD_ACTION_ROUTE_KEY] : null;
      if (!route) {
        log.warn('[feishu-card] 回调缺少路由字段，忽略');
        return null;
      }
      const processor = this.processors.get(route);
      if (!processor) {
        log.warn(`[feishu-card] 未注册的回调: ${route}`);
        return null;
      }
      const ctx: CardActionContext = {
        chatId: data.context?.open_chat_id,
        messageId: data.context?.open_message_id,
        operatorOpenId: data.operator?.open_id,
      };
      return await withTimeout(Promise.resolve(processor(value ?? {}, ctx)));
    } catch (err) {
      log.error('[feishu-card] 回调分发失败:', err);
      return null;
    }
  }
}

export const feishuCardController = new FeishuCardController();
