import type { Client } from '@larksuiteoapi/node-sdk';
import { mainLogger } from '../../agents/logger.js';
import { feishuClientService } from './feishu-client-service.js';

const log = mainLogger;

export interface StreamCardHandle {
  cardId: string;
  elementId: string;
  sequence: number;
}

export type CardKitFailureKind = 'degradable' | 'transient';

export type CardKitResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; kind: CardKitFailureKind };

export interface EndStreamResult {
  ok: boolean;
  contentDelivered: boolean;
  error?: string;
  kind?: CardKitFailureKind;
}

export interface CardUpdateAction {
  action: string;
  params: Record<string, unknown>;
}

export interface CardElementHandle {
  cardId: string;
  elementId: string;
}

interface ApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

const STREAM_ELEMENT_ID = 'dogear_stream_md';

// 99991672 = 开放平台通用「无权限访问该接口」，出现即整段降级（cardkit:card:write 未批）
const DEGRADABLE_API_CODES = new Set([99991672]);

function buildStreamingCard(content: string, title?: string): object {
  return {
    schema: '2.0',
    ...(title ? { header: { title: { tag: 'plain_text', content: title } } } : {}),
    config: { update_multi: true, streaming_mode: true },
    body: {
      elements: [{ tag: 'markdown', content, element_id: STREAM_ELEMENT_ID }],
    },
  };
}

// JSON 2.0 回传按钮：点击触发 card.action.trigger，value 原样回传（路由字段约定见 feishu-card-controller）
export function buildCallbackButton(
  text: string,
  value: Record<string, unknown>,
  opts?: { type?: string; elementId?: string; size?: 'tiny' | 'small' | 'medium' | 'large' },
): object {
  return {
    tag: 'button',
    ...(opts?.elementId ? { element_id: opts.elementId } : {}),
    type: opts?.type ?? 'primary',
    size: opts?.size ?? 'small',
    text: { tag: 'plain_text', content: text },
    behaviors: [{ type: 'callback', value }],
  };
}

export function buildButtonCard(opts: {
  title: string;
  template?: string;
  elements: object[];
  buttons?: object[];
}): object {
  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: opts.title },
      ...(opts.template ? { template: opts.template } : {}),
    },
    config: { update_multi: true },
    body: {
      elements: [...opts.elements, ...(opts.buttons?.length ? [{ tag: 'hr' }, ...opts.buttons] : [])],
    },
  };
}

function classifyFailure(code?: number): CardKitFailureKind {
  if (code !== undefined && DEGRADABLE_API_CODES.has(code)) return 'degradable';
  return 'transient';
}

class FeishuCardKit {
  isReady(): boolean {
    return feishuClientService.getClient() !== null;
  }

  async createStreamingCard(placeholder: string, title?: string): Promise<CardKitResult<StreamCardHandle>> {
    const client = feishuClientService.getClient();
    if (!client) return { ok: false, error: '飞书未连接', kind: 'degradable' };
    try {
      const res = (await client.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(buildStreamingCard(placeholder, title)) },
      })) as ApiEnvelope<{ card_id?: string }>;
      if (res.code !== 0 || !res.data?.card_id) {
        return {
          ok: false,
          error: `创建卡片实体失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return {
        ok: true,
        value: { cardId: res.data.card_id, elementId: STREAM_ELEMENT_ID, sequence: 1 },
      };
    } catch (err) {
      return { ok: false, error: `创建卡片实体异常：${String(err)}`, kind: 'transient' };
    }
  }

  async createCard(card: object): Promise<CardKitResult<string>> {
    const client = feishuClientService.getClient();
    if (!client) return { ok: false, error: '飞书未连接', kind: 'degradable' };
    try {
      const res = (await client.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(card) },
      })) as ApiEnvelope<{ card_id?: string }>;
      if (res.code !== 0 || !res.data?.card_id) {
        return {
          ok: false,
          error: `创建卡片实体失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return { ok: true, value: res.data.card_id };
    } catch (err) {
      return { ok: false, error: `创建卡片实体异常：${String(err)}`, kind: 'transient' };
    }
  }

  // 卡片实体局部更新（原子批量操作）；sequence 必须严格递增
  async batchUpdate(cardId: string, actions: CardUpdateAction[], sequence: number): Promise<CardKitResult<null>> {
    const client = feishuClientService.getClient();
    if (!client) return { ok: false, error: '飞书未连接', kind: 'transient' };
    try {
      const res = (await client.cardkit.v1.card.batchUpdate({
        data: {
          sequence,
          actions: JSON.stringify(actions.map((a) => ({ action: a.action, params: a.params }))),
        },
        path: { card_id: cardId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return {
          ok: false,
          error: `卡片局部更新失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, error: `卡片局部更新异常：${String(err)}`, kind: 'transient' };
    }
  }

  // 全量更新卡片实体（覆盖整个卡 JSON）；sequence 必须严格递增，失败含过期/权限降级
  async updateCard(cardId: string, card: object, sequence: number): Promise<CardKitResult<null>> {
    const client = feishuClientService.getClient();
    if (!client) return { ok: false, error: '飞书未连接', kind: 'transient' };
    try {
      const res = (await client.cardkit.v1.card.update({
        data: { card: { type: 'card_json', data: JSON.stringify(card) }, sequence },
        path: { card_id: cardId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return {
          ok: false,
          error: `卡片更新失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, error: `卡片更新异常：${String(err)}`, kind: 'transient' };
    }
  }

  async appendText(handle: StreamCardHandle, fullText: string): Promise<CardKitResult<null>> {
    const client = feishuClientService.getClient();
    if (!client) return { ok: false, error: '飞书未连接', kind: 'transient' };
    try {
      const res = (await client.cardkit.v1.cardElement.content({
        data: { content: fullText, sequence: handle.sequence++ },
        path: { card_id: handle.cardId, element_id: handle.elementId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return {
          ok: false,
          error: `流式更新失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return { ok: true, value: null };
    } catch (err) {
      return { ok: false, error: `流式更新异常：${String(err)}`, kind: 'transient' };
    }
  }

  // 先尽力推送终态全文，再关 streaming_mode（关流后飞书会把打字机未输出的余量一次刷出）
  async endStream(handle: StreamCardHandle, finalText: string): Promise<EndStreamResult> {
    const pushed = await this.appendText(handle, finalText);
    if (!pushed.ok) {
      log.warn(`[feishu-cardkit] 终态全文推送失败，仍尝试关闭流式: ${pushed.error}`);
    }
    const client = feishuClientService.getClient();
    if (!client) {
      return { ok: false, contentDelivered: pushed.ok, error: '飞书未连接', kind: 'transient' };
    }
    try {
      const res = (await client.cardkit.v1.card.settings({
        data: {
          settings: JSON.stringify({ config: { update_multi: true, streaming_mode: false } }),
          sequence: handle.sequence++,
        },
        path: { card_id: handle.cardId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return {
          ok: false,
          contentDelivered: pushed.ok,
          error: `关闭流式失败：${res.msg || `code=${res.code}`}`,
          kind: classifyFailure(res.code),
        };
      }
      return { ok: true, contentDelivered: pushed.ok };
    } catch (err) {
      return {
        ok: false,
        contentDelivered: pushed.ok,
        error: `关闭流式异常：${String(err)}`,
        kind: 'transient',
      };
    }
  }
}

export const feishuCardKit = new FeishuCardKit();
