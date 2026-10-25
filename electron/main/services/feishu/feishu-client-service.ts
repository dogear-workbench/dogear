import { Client, Domain, EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk';
import { broadcastToWindows } from '../renderer-broadcast.js';
import { feishuConfigService, type FeishuConnectionState } from './feishu-config-service.js';
import { feishuCardController, type CardActionTriggerData } from './feishu-card-controller.js';

// 类型镜像自 types/feishu.ts（主进程 rootDir 限制，不能跨目录 import）

export interface FeishuIncomingMessage {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  text: string;
  chatType?: 'p2p' | 'group';
  threadId?: string;
  rootId?: string;
  parentId?: string;
}

export interface FeishuActionResult {
  ok: boolean;
  error?: string;
  code?: number;
  messageId?: string;
}

interface ImReceiveEvent {
  sender?: {
    sender_id?: {
      open_id?: string;
    };
  };
  message?: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    thread_id?: string;
    root_id?: string;
    parent_id?: string;
  };
}

interface ApiEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

type FeishuStateListener = (state: FeishuConnectionState, errorMessage?: string) => void;
type FeishuMessageHandler = (msg: FeishuIncomingMessage) => void | Promise<void>;

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_TEXT_LEN = 4000;

function splitTextSegments(text: string): string[] {
  if (text.length <= MAX_TEXT_LEN) return [text];
  return Array.from({ length: Math.ceil(text.length / MAX_TEXT_LEN) }, (_, i) =>
    text.slice(i * MAX_TEXT_LEN, (i + 1) * MAX_TEXT_LEN));
}

function broadcastFeishuState(state: FeishuConnectionState, errorMessage?: string): void {
  broadcastToWindows((h) => h.feishuConnectionStatus.send({ state, errorMessage }));
}

class FeishuClientService {
  private client: Client | null = null;
  private wsClient: WSClient | null = null;
  private state: FeishuConnectionState = 'disconnected';
  private errorMessage: string | undefined;
  private onMessage: FeishuMessageHandler | null = null;
  private stateListeners = new Set<FeishuStateListener>();
  private connectGeneration = 0;

  isRunning(): boolean {
    return this.wsClient !== null;
  }

  getStatus(): { state: FeishuConnectionState; errorMessage?: string } {
    return { state: this.state, errorMessage: this.errorMessage };
  }

  onStateChange(cb: FeishuStateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  async connect(appId: string, appSecret: string, onMessage: FeishuMessageHandler): Promise<FeishuActionResult> {
    this.connectGeneration++;
    await this.teardown();
    const generation = this.connectGeneration;
    this.onMessage = onMessage;
    this.setState('connecting');

    this.client = new Client({ appId, appSecret, domain: Domain.Feishu, loggerLevel: LoggerLevel.warn });

    const dispatcher = new EventDispatcher({ loggerLevel: LoggerLevel.warn });
    dispatcher.register({
      'im.message.receive_v1': (data: ImReceiveEvent) => {
        if (generation !== this.connectGeneration) return;
        this.handleReceive(data);
      },
      // card.action.trigger 依赖 patchedDependencies 里对 WSClient 的 card 帧放行补丁
      'card.action.trigger': (data: CardActionTriggerData) => {
        if (generation !== this.connectGeneration) return null;
        return feishuCardController.handleAction(data);
      },
    });

    return new Promise<FeishuActionResult>((resolve) => {
      let settled = false;
      const settle = (result: FeishuActionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timeout = setTimeout(() => {
        settle({ ok: false, error: '连接超时，请检查网络后重试' });
      }, CONNECT_TIMEOUT_MS);

      const wsClient = new WSClient({
        appId,
        appSecret,
        domain: Domain.Feishu,
        autoReconnect: true,
        loggerLevel: LoggerLevel.warn,
        onReady: () => {
          if (generation !== this.connectGeneration) return;
          clearTimeout(timeout);
          this.setState('connected');
          void this.refreshConnectedMeta(appId, appSecret);
          settle({ ok: true });
        },
        onReconnecting: () => {
          if (generation !== this.connectGeneration) return;
          this.setState('connecting');
        },
        onReconnected: () => {
          if (generation !== this.connectGeneration) return;
          this.setState('connected');
        },
        onError: (err) => {
          if (generation !== this.connectGeneration) return;
          clearTimeout(timeout);
          this.setState('error', err.message);
          settle({ ok: false, error: `连接失败：${err.message}` });
        },
      });
      this.wsClient = wsClient;

      wsClient.start({ eventDispatcher: dispatcher }).catch((err) => {
        if (generation !== this.connectGeneration) return;
        clearTimeout(timeout);
        this.setState('error', String(err));
        settle({ ok: false, error: `连接失败：${String(err)}` });
      });
    });
  }

  async disconnect(): Promise<void> {
    this.connectGeneration++;
    await this.teardown();
    this.setState('disconnected');
  }

  async replyText(messageId: string, text: string): Promise<FeishuActionResult> {
    let last: FeishuActionResult = { ok: true };
    for (const segment of splitTextSegments(text)) {
      const res = await this.reply(messageId, 'text', JSON.stringify({ text: segment }));
      if (!res.ok) return res;
      last = res;
    }
    return last;
  }

  async replyCard(messageId: string, card: object): Promise<FeishuActionResult> {
    return this.reply(messageId, 'interactive', JSON.stringify(card));
  }

  async replyCardRef(messageId: string, cardId: string): Promise<FeishuActionResult> {
    return this.reply(messageId, 'interactive', JSON.stringify({ type: 'card', data: { card_id: cardId } }));
  }

  getClient(): Client | null {
    return this.client;
  }

  async sendDirectText(openId: string, text: string): Promise<FeishuActionResult> {
    let last: FeishuActionResult = { ok: true };
    for (const segment of splitTextSegments(text)) {
      const res = await this.sendDirectTextOnce(openId, segment);
      if (!res.ok) return res;
      last = res;
    }
    return last;
  }

  private async sendDirectTextOnce(openId: string, text: string): Promise<FeishuActionResult> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.message.create({
        data: { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) },
        params: { receive_id_type: 'open_id' },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `发送私聊消息失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `发送私聊消息失败：${String(err)}` };
    }
  }

  async createChat(name: string, userOpenId: string): Promise<FeishuActionResult & { chatId?: string }> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.chat.create({
        data: { name, group_message_type: 'thread', user_id_list: [userOpenId] },
        params: { user_id_type: 'open_id' },
      })) as ApiEnvelope<{ chat_id?: string }>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `创建话题群失败：${res.msg || `code=${res.code}`}` };
      }
      if (!res.data?.chat_id) {
        return { ok: false, error: '创建话题群失败：响应缺少 chat_id' };
      }
      return { ok: true, chatId: res.data.chat_id };
    } catch (err) {
      return { ok: false, error: `创建话题群失败：${String(err)}` };
    }
  }

  // 发送引用 cardkit 实体的群卡片消息（话题群中首条此类消息即新话题的根消息）
  async createGroupCardMessage(
    chatId: string,
    cardId: string,
  ): Promise<FeishuActionResult & { messageId?: string; threadId?: string }> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
        },
        params: { receive_id_type: 'chat_id' },
      })) as ApiEnvelope<{ message_id?: string; thread_id?: string }>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `发送群卡片消息失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true, messageId: res.data?.message_id, threadId: res.data?.thread_id };
    } catch (err) {
      return { ok: false, error: `发送群卡片消息失败：${String(err)}` };
    }
  }

  async pinMessage(messageId: string): Promise<FeishuActionResult> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.pin.create({
        data: { message_id: messageId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `Pin 消息失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Pin 消息失败：${String(err)}` };
    }
  }

  async unpinMessage(messageId: string): Promise<FeishuActionResult> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.pin.delete({
        path: { message_id: messageId },
      })) as ApiEnvelope<unknown>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `取消 Pin 失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `取消 Pin 失败：${String(err)}` };
    }
  }

  async createGroupMessage(
    chatId: string,
    text: string,
  ): Promise<FeishuActionResult & { messageId?: string; threadId?: string }> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.message.create({
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
        params: { receive_id_type: 'chat_id' },
      })) as ApiEnvelope<{ message_id?: string; thread_id?: string }>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `发送群消息失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true, messageId: res.data?.message_id, threadId: res.data?.thread_id };
    } catch (err) {
      return { ok: false, error: `发送群消息失败：${String(err)}` };
    }
  }

  private async reply(messageId: string, msgType: string, content: string): Promise<FeishuActionResult> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.message.reply({
        data: { content, msg_type: msgType },
        path: { message_id: messageId },
      })) as ApiEnvelope<{ message_id?: string }>;
      if (res.code !== 0) {
        return { ok: false, code: res.code, error: `飞书消息发送失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true, messageId: res.data?.message_id };
    } catch (err) {
      return { ok: false, error: `飞书消息发送失败：${String(err)}` };
    }
  }

  private async teardown(): Promise<void> {
    const ws = this.wsClient;
    this.wsClient = null;
    this.client = null;
    this.onMessage = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // 已关闭
      }
    }
  }

  private handleReceive(data: ImReceiveEvent): void {
    try {
      const message = data.message;
      if (!message || message.message_type !== 'text') return;
      const isP2p = message.chat_type === 'p2p';
      const isThread = message.chat_type === 'group' && !!message.thread_id;
      if (!isP2p && !isThread) return;
      const senderOpenId = data.sender?.sender_id?.open_id;
      if (!senderOpenId) return;
      let text = '';
      try {
        text = String(JSON.parse(message.content)?.text ?? '');
      } catch {
        return;
      }
      const parsed: FeishuIncomingMessage = {
        messageId: message.message_id,
        chatId: message.chat_id,
        senderOpenId,
        text,
        chatType: isP2p ? 'p2p' : 'group',
        threadId: message.thread_id,
        rootId: message.root_id,
        parentId: message.parent_id,
      };
      void Promise.resolve(this.onMessage?.(parsed)).catch((err) => {
        console.error('[feishu] 消息处理失败:', err);
      });
    } catch (err) {
      console.error('[feishu] 事件解析失败:', err);
    }
  }

  private async refreshConnectedMeta(appId: string, appSecret: string): Promise<void> {
    try {
      const cfg = await feishuConfigService.loadConfig();
      if (!cfg || cfg.appId !== appId) return;
      if (!cfg.botName) {
        const test = await feishuConfigService.testConnection(appId, appSecret);
        if (test.ok && test.botName) {
          await feishuConfigService.saveConfig({ ...cfg, botName: test.botName, connectedAt: new Date().toISOString() });
          return;
        }
      }
      await feishuConfigService.saveConfig({ ...cfg, connectedAt: new Date().toISOString() });
    } catch {
      // 回写失败不影响连接
    }
  }

  private setState(state: FeishuConnectionState, errorMessage?: string): void {
    if (this.state === state && this.errorMessage === errorMessage) return;
    this.state = state;
    this.errorMessage = errorMessage;
    broadcastFeishuState(state, errorMessage);
    for (const cb of this.stateListeners) {
      try {
        cb(state, errorMessage);
      } catch {
        // 单个监听器异常不影响其余监听器
      }
    }
  }
}

export const feishuClientService = new FeishuClientService();
