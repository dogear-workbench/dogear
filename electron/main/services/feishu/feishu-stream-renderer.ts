import { mainLogger } from '../../agents/logger.js';
import { feishuClientService } from './feishu-client-service.js';
import { feishuCardKit, type StreamCardHandle } from './feishu-cardkit.js';
import { markdownToCard } from './feishu-card.js';

const log = mainLogger;

export type ReplyCtx = {
  messageId: string;
  chatId: string;
  senderOpenId: string;
  threadId?: string;
  workspaceId?: string;
  conversationId?: string;
  conversationTitle?: string;
};

const STREAM_PLACEHOLDER = '[生成中...]';
const STREAM_EMPTY_HINT = '（无内容）';
const STREAM_THROTTLE_MS = 500;
const CARD_ROTATE_SOFT_BYTES = 20 * 1024;
const CARD_HARD_BYTES = 28 * 1024;
const MAX_FINALIZE_CARDS = 20;

// 按 utf8 字节数预算找字符串切点（回退到码点边界，不切破 surrogate pair）
function cutByBytes(text: string, limit: number): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) ?? 0;
    const size = code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1;
    if (bytes + size > limit) return i;
    bytes += size;
    if (code > 0xffff) i++;
  }
  return text.length;
}

interface StreamState {
  handle: StreamCardHandle | null;
  ctx: ReplyCtx;
  text: string;
  rotateOffset: number;
  lastFlush: number;
  flushing: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void>;
  beginPromise: Promise<void>;
}

export class FeishuStreamRenderer {
  private streams = new Map<string, StreamState>();
  private degradedSessions = new Set<string>();

  constructor(private resolveCtx: (sessionId: string) => ReplyCtx | null) {}

  isDegraded(sessionId: string): boolean {
    return this.degradedSessions.has(sessionId);
  }
  async handleReply(sessionId: string, text: string): Promise<void> {
    const st = this.streams.get(sessionId);
    if (!st) {
      if (text) await this.sendFallbackCards(sessionId, text);
      return;
    }
    const finalized = await this.finalizeStream(sessionId, text);
    // 未定格 = 降级发生在 finalize 内部 / handle 为空 / 分卡中断：宁可重发不丢内容
    if (!finalized && text) await this.sendFallbackCards(sessionId, text);
  }

  async finalizeOnly(sessionId: string, finalText: string | null): Promise<void> {
    if (!this.streams.get(sessionId)) return;
    await this.finalizeStream(sessionId, finalText);
  }


  appendChunk(sessionId: string, content: string, waiting: boolean): void {
    if (this.degradedSessions.has(sessionId)) return;
    const ctx = this.resolveCtx(sessionId);
    if (!ctx || !waiting) return;

    const existing = this.streams.get(sessionId);
    if (existing) {
      existing.text += content;
      this.scheduleFlush(sessionId);
      return;
    }

    if (!feishuCardKit.isReady()) {
      this.degradedSessions.add(sessionId);
      return;
    }

    const fresh: StreamState = {
      handle: null,
      ctx,
      text: content,
      rotateOffset: 0,
      lastFlush: 0,
      flushing: false,
      flushTimer: null,
      flushPromise: Promise.resolve(),
      beginPromise: Promise.resolve(),
    };
    this.streams.set(sessionId, fresh);
    fresh.beginPromise = this.startStream(sessionId, ctx.messageId);
  }

  async abortAll(): Promise<void> {
    const ids = [...this.streams.keys()];
    await Promise.all(ids.map((id) => this.finalizeStream(id, null)));
  }

  private async startStream(sessionId: string, replyMessageId: string): Promise<void> {
    const st = this.streams.get(sessionId);
    if (!st) return;

    const created = await feishuCardKit.createStreamingCard(STREAM_PLACEHOLDER, st.ctx.conversationTitle);
    if (!created.ok) {
      log.warn(`[feishu-bot] 流式卡片创建失败，降级整段卡片: ${created.error}`);
      this.markDegraded(sessionId);
      return;
    }
    const sent = await feishuClientService.replyCardRef(replyMessageId, created.value.cardId);
    if (!sent.ok) {
      log.warn(`[feishu-bot] 流式卡片发送失败，降级整段卡片: ${sent.error}`);
      this.markDegraded(sessionId);
      return;
    }
    if (this.streams.get(sessionId) !== st) return;
    st.handle = created.value;
    st.lastFlush = Date.now();
    this.scheduleFlush(sessionId);
  }

  private markDegraded(sessionId: string): void {
    this.degradedSessions.add(sessionId);
    const st = this.streams.get(sessionId);
    if (st?.flushTimer) clearTimeout(st.flushTimer);
    this.streams.delete(sessionId);
  }

  private scheduleFlush(sessionId: string): void {
    const st = this.streams.get(sessionId);
    if (!st || st.flushing) return;
    const elapsed = Date.now() - st.lastFlush;
    if (elapsed >= STREAM_THROTTLE_MS) {
      void this.flushStream(sessionId);
      return;
    }
    if (st.flushTimer) return;
    st.flushTimer = setTimeout(() => {
      st.flushTimer = null;
      if (this.streams.get(sessionId) === st) void this.flushStream(sessionId);
    }, STREAM_THROTTLE_MS - elapsed);
  }

  private flushStream(sessionId: string): Promise<void> {
    const st = this.streams.get(sessionId);
    if (!st || st.flushing) return st ? st.flushPromise : Promise.resolve();
    st.flushing = true;
    const run = this.doFlush(sessionId);
    st.flushPromise = run;
    return run;
  }

  private async doFlush(sessionId: string): Promise<void> {
    try {
      await this.maybeRotate(sessionId);
      const cur = this.streams.get(sessionId);
      if (!cur?.handle) return;
      const visible = cur.text.slice(cur.rotateOffset);
      if (!visible) return;
      const res = await feishuCardKit.appendText(cur.handle, visible);
      cur.lastFlush = Date.now();
      if (!res.ok) {
        log.warn(`[feishu-bot] 流式更新失败: ${res.error}`);
      }
    } finally {
      const cur = this.streams.get(sessionId);
      if (cur) {
        cur.flushing = false;
        if (cur.handle) this.scheduleFlush(sessionId);
      }
    }
  }

  private async maybeRotate(sessionId: string): Promise<void> {
    const st = this.streams.get(sessionId);
    if (!st?.handle) return;
    const visible = st.text.slice(st.rotateOffset);
    if (Buffer.byteLength(visible, 'utf8') <= CARD_ROTATE_SOFT_BYTES) return;
    await this.rotateCard(sessionId);
  }


  private async rotateCard(sessionId: string): Promise<void> {
    const st = this.streams.get(sessionId);
    if (!st?.handle) return;
    const visible = st.text.slice(st.rotateOffset);
    const cut = cutByBytes(visible, CARD_HARD_BYTES);
    const ended = await feishuCardKit.endStream(
      st.handle,
      visible.slice(0, cut) || STREAM_PLACEHOLDER,
    );
    if (!ended.contentDelivered) {
      log.warn(`[feishu-bot] 分卡前段内容未送达，停止流式: ${ended.error || '关流成功但内容未送达'}`);
      this.markDegraded(sessionId);
      return;
    }

    const tail = visible.slice(cut);
    const created = await feishuCardKit.createStreamingCard(tail || STREAM_PLACEHOLDER, st.ctx.conversationTitle);
    if (!created.ok) {
      log.warn(`[feishu-bot] 续写卡片创建失败，停止流式: ${created.error}`);
      this.markDegraded(sessionId);
      return;
    }
    const sent = await feishuClientService.replyCardRef(st.ctx.messageId, created.value.cardId);
    if (!sent.ok) {
      log.warn(`[feishu-bot] 续写卡片发送失败，停止流式: ${sent.error}`);
      this.markDegraded(sessionId);
      return;
    }
    const cur = this.streams.get(sessionId);
    if (!cur) return;
    cur.handle = created.value;
    cur.rotateOffset = st.rotateOffset + cut;
    cur.lastFlush = Date.now();
  }

  /** 返回是否成功定格（false = 内容未落进流式卡片，调用方需兜底补发） */
  private async finalizeStream(sessionId: string, finalText: string | null): Promise<boolean> {
    const st = this.streams.get(sessionId);
    if (!st) return false;
    if (st.flushTimer) {
      clearTimeout(st.flushTimer);
      st.flushTimer = null;
    }
    await st.beginPromise;
    await st.flushPromise;
    if (st.flushTimer) {
      clearTimeout(st.flushTimer);
      st.flushTimer = null;
    }
    if (finalText !== null) st.text = finalText;

    try {
      let guard = 0;
      while (st.handle && guard++ < MAX_FINALIZE_CARDS) {
        const visible = st.text.slice(st.rotateOffset);
        if (Buffer.byteLength(visible, 'utf8') <= CARD_HARD_BYTES) {
          const res = await feishuCardKit.endStream(st.handle, visible || STREAM_EMPTY_HINT);
          if (!res.contentDelivered) {
            log.warn(`[feishu-bot] 终态全文未送达，需兜底补发: ${res.error || '关流成功但内容未送达'}`);
            return false;
          }
          if (!res.ok) log.warn(`[feishu-bot] 关闭流式失败（内容已完整送达）: ${res.error}`);
          return true;
        }
        const before = st.rotateOffset;
        await this.rotateCard(sessionId);
        if (this.streams.get(sessionId) !== st || st.rotateOffset === before) {
          log.warn('[feishu-bot] 定格分卡中断，尾部内容可能缺失');
          return false;
        }
      }
    } finally {
      this.streams.delete(sessionId);
    }
    // handle 为空（startStream 降级删态）或超分卡上限：未定格
    return false;
  }

  private async sendFallbackCards(sessionId: string, text: string): Promise<void> {
    const ctx = this.resolveCtx(sessionId);
    if (!ctx) return;
    for (const card of markdownToCard(text, ctx.conversationTitle)) {
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

  reset(): void {
    for (const st of this.streams.values()) {
      if (st.flushTimer) clearTimeout(st.flushTimer);
    }
    this.streams.clear();
    this.degradedSessions.clear();
  }
}
