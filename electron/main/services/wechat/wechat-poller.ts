/**
 * 微信 iLink 长轮询器
 *
 * 状态机：
 *   STOPPED --(start)--> POLLING
 *   POLLING --(收到消息)--> 处理 → 继续 POLLING
 *   POLLING --(超时无消息)--> 继续 POLLING
 *   POLLING --(401/ret=-14)--> STOPPED（触发重新认证）
 *   POLLING --(网络错误)--> BACKOFF（指数退避 1s→2s→4s...max 30s）
 *   BACKOFF --(定时器到)--> POLLING
 *   POLLING --(stop)--> STOPPED
 *
 * cursor (get_updates_buf) 持久化到 .dogear/wechat/poll-state.json
 */

import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { wechatILinkService, type ILinkRawMessage } from './wechat-ilink-service.js';

const { app } = electron;

// ============================================================
// 类型
// ============================================================

export type PollerStatus = 'stopped' | 'polling' | 'backoff' | 'error';

export interface PollerState {
  status: PollerStatus;
  lastPollAt?: string;
  errorMessage?: string;
}

/** 解析后的消息（从 iLink 原始格式转换） */
export interface ParsedMessage {
  id: string;
  contextToken: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: string;
  timestamp: number;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  isOutgoing: false;
}

export type OnMessageCallback = (messages: ParsedMessage[]) => void;
export type OnStatusCallback = (state: PollerState) => void;
export type OnAuthExpiredCallback = () => void;

// ============================================================
// 工具
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getPollStatePath(): string {
  return path.join(getConfigDir(), 'wechat', 'poll-state.json');
}

/** 从 iLink 原始消息中提取文本内容 */
function extractContent(raw: ILinkRawMessage): { content: string; messageType: string } {
  if (!raw.item_list || raw.item_list.length === 0) {
    return { content: '', messageType: 'unknown' };
  }

  const item = raw.item_list[0];
  switch (item.type) {
    case 1: // TEXT
      return { content: item.text_item?.text || '', messageType: 'text' };
    case 2: // IMAGE
      return { content: '[图片]', messageType: 'image' };
    case 3: // VOICE
      return { content: item.voice_item?.text ? `[语音] ${item.voice_item.text}` : '[语音]', messageType: 'voice' };
    case 4: // FILE
      return { content: `[文件] ${item.file_item?.file_name || ''}`, messageType: 'file' };
    case 5: // VIDEO
      return { content: '[视频]', messageType: 'video' };
    default:
      return { content: `[未知消息类型 ${item.type}]`, messageType: 'unknown' };
  }
}

/** 将 iLink 原始消息转换为统一格式 */
function parseRawMessage(raw: ILinkRawMessage): ParsedMessage {
  const { content, messageType } = extractContent(raw);

  const ts = raw.create_time_ms ? raw.create_time_ms : Date.now();
  return {
    id: String(raw.message_id ?? `${raw.from_user_id}_${ts}`),
    contextToken: raw.context_token || '',
    senderId: raw.from_user_id || '',
    senderName: raw.from_user_id || '',
    content,
    messageType,
    timestamp: ts,
    isGroup: !!raw.group_id,
    groupId: raw.group_id,
    groupName: undefined,
    isOutgoing: false,
  };
}

// ============================================================
// 轮询器
// ============================================================

class WechatPoller {
  private status: PollerStatus = 'stopped';
  private abortController: AbortController | null = null;
  private cursor: string = '';
  private backoffMs: number = 1000;

  private onMessage: OnMessageCallback | null = null;
  private onStatus: OnStatusCallback | null = null;
  private onAuthExpired: OnAuthExpiredCallback | null = null;

  private botToken: string = '';
  private baseUrl: string = '';

  isRunning(): boolean {
    return this.status !== 'stopped';
  }

  getStatus(): PollerState {
    return { status: this.status };
  }

  /**
   * 启动长轮询
   */
  async start(
    botToken: string,
    baseUrl: string,
    callbacks: {
      onMessage: OnMessageCallback;
      onStatus: OnStatusCallback;
      onAuthExpired: OnAuthExpiredCallback;
    },
  ): Promise<void> {
    if (this.isRunning()) {
      this.stop();
    }

    this.botToken = botToken;
    this.baseUrl = baseUrl;
    this.onMessage = callbacks.onMessage;
    this.onStatus = callbacks.onStatus;
    this.onAuthExpired = callbacks.onAuthExpired;
    this.backoffMs = 1000;

    // 加载持久化的 cursor
    await this.loadCursor();

    this.abortController = new AbortController();
    this.status = 'polling';
    this.emitStatus();

    // 启动轮询循环（不阻塞）
    this.pollLoop().catch(() => { /* 被取消 */ });
  }

  /** 停止轮询 */
  stop(): void {
    this.status = 'stopped';
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onMessage = null;
    this.onStatus = null;
    this.onAuthExpired = null;
    this.emitStatus();
  }

  /** 轮询主循环 */
  private async pollLoop(): Promise<void> {
    while (this.status !== 'stopped' && this.abortController && !this.abortController.signal.aborted) {
      try {
        this.status = 'polling';

        const response = await wechatILinkService.getUpdates(
          this.botToken,
          this.baseUrl,
          this.cursor,
          this.abortController.signal,
        );

        // stop() 可能在 await 期间被异步调用
        if (this.abortController?.signal.aborted) return;

        // 检查认证失效
        if (response.ret === -14) {
          this.status = 'error';
          this.emitStatus('Session 已过期，请重新扫码');
          this.onAuthExpired?.();
          this.stop();
          return;
        }

        if (response.ret !== 0) {
          // 其他错误，进入退避
          this.enterBackoff(`iLink 错误: ret=${response.ret} ${response.errmsg || ''}`);
          continue;
        }

        // 更新 cursor
        if (response.get_updates_buf) {
          this.cursor = response.get_updates_buf;
          await this.saveCursor();
        }

        // 处理消息
        if (response.msgs && response.msgs.length > 0) {
          const parsed = response.msgs.map(parseRawMessage);
          this.onMessage?.(parsed);
        }

        // 成功，重置退避
        this.backoffMs = 1000;
        this.emitStatus();

      } catch (err: any) {
        if (this.abortController?.signal.aborted) return;
        if (err.name === 'AbortError') return;

        // 网络错误，进入退避
        this.enterBackoff(`网络错误: ${err.message}`);
      }
    }
  }

  /** 进入指数退避 */
  private async enterBackoff(errorMessage: string): Promise<void> {
    if (this.status === 'stopped') return;

    this.status = 'backoff';
    this.emitStatus(errorMessage);

    // 等待退避时间
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.backoffMs);
      // 如果被取消，清理定时器
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });

    // 指数退避，最大 30s
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  }

  /** 发出状态事件 */
  private emitStatus(errorMessage?: string): void {
    this.onStatus?.({
      status: this.status,
      lastPollAt: this.status === 'polling' ? new Date().toISOString() : undefined,
      errorMessage,
    });
  }

  /** 加载持久化的 cursor */
  private async loadCursor(): Promise<void> {
    try {
      const content = await fs.readFile(getPollStatePath(), 'utf-8');
      const state = JSON.parse(content);
      this.cursor = state.cursor || '';
    } catch {
      this.cursor = '';
    }
  }

  /** 保存 cursor */
  private async saveCursor(): Promise<void> {
    try {
      const dir = path.dirname(getPollStatePath());
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        getPollStatePath(),
        JSON.stringify({ cursor: this.cursor, updatedAt: new Date().toISOString() }),
        'utf-8',
      );
    } catch {
      // 保存失败不影响轮询
    }
  }
}

export const wechatPoller = new WechatPoller();
