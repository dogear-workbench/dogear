import { Client, Domain, EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk';
import { broadcastToWindows } from '../renderer-broadcast.js';
import { feishuConfigService, type FeishuConnectionState } from './feishu-config-service.js';

// 类型镜像自 types/feishu.ts（主进程 rootDir 限制，不能跨目录 import）

export interface FeishuIncomingMessage {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  text: string;
}

export interface FeishuActionResult {
  ok: boolean;
  error?: string;
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
  };
}

interface ReplyApiResult {
  code?: number;
  msg?: string;
}

type FeishuStateListener = (state: FeishuConnectionState, errorMessage?: string) => void;
type FeishuMessageHandler = (msg: FeishuIncomingMessage) => void | Promise<void>;

const CONNECT_TIMEOUT_MS = 15_000;

function broadcastFeishuState(state: FeishuConnectionState, errorMessage?: string): void {
  broadcastToWindows((h) => h.feishuConnectionStatus.send({ state, errorMessage }));
}

// Step 3 接入 bot controller 前的占位处理
export function logIncomingMessage(msg: FeishuIncomingMessage): void {
  console.log('[feishu] 收到 p2p 文本消息:', JSON.stringify(msg));
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
    return this.reply(messageId, 'text', JSON.stringify({ text }));
  }

  async replyCard(messageId: string, card: Record<string, unknown>): Promise<FeishuActionResult> {
    return this.reply(messageId, 'interactive', JSON.stringify(card));
  }

  private async reply(messageId: string, msgType: string, content: string): Promise<FeishuActionResult> {
    const client = this.client;
    if (!client) return { ok: false, error: '飞书未连接' };
    try {
      const res = (await client.im.message.reply({
        data: { content, msg_type: msgType },
        path: { message_id: messageId },
      })) as ReplyApiResult;
      if (res.code !== 0) {
        return { ok: false, error: `飞书消息发送失败：${res.msg || `code=${res.code}`}` };
      }
      return { ok: true };
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
      if (!message || message.chat_type !== 'p2p' || message.message_type !== 'text') return;
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

// 主进程启动自动连接：检测到已保存凭证即建常驻 WS
export async function autoConnectFeishu(): Promise<void> {
  const cfg = await feishuConfigService.loadConfig();
  if (!cfg) return;
  console.log('[feishu] 检测到已保存凭证，自动连接中...');
  const res = await feishuClientService.connect(cfg.appId, cfg.appSecret, logIncomingMessage);
  if (res.ok) {
    console.log('[feishu] 自动连接成功');
  } else {
    console.error('[feishu] 自动连接失败:', res.error);
  }
}
