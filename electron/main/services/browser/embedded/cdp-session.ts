import type { WebContents } from 'electron';
import type { EmbeddedTabRecord } from './types.js';

export const CDP_COMMAND_TIMEOUT_MS = 8_000;
export const CDP_OBSERVE_TIMEOUT_MS = 12_000;

export interface CdpResponse {
  [key: string]: unknown;
}

export class CdpTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`页面未在 ${Math.ceil(timeoutMs / 1000)} 秒内响应 ${method}，页面可能卡死，请稍后重试或重新加载页面。`);
    this.name = 'CdpTimeoutError';
  }
}

type DebuggerClient = WebContents['debugger'];

/**
 * CDP 命令可能永不 settle（页面进程卡死 / DevTools 通道异常）；超时只让调用方继续，
 * 底层 command 后续 settle 时被安全忽略。
 */
function withCdpTimeout<T>(method: string, timeoutMs: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CdpTimeoutError(method, timeoutMs)), timeoutMs);
    Promise.resolve()
      .then(run)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

export class EmbeddedCdpSession {
  private readonly tab: EmbeddedTabRecord;

  constructor(tab: EmbeddedTabRecord) {
    this.tab = tab;
  }

  private client(): DebuggerClient {
    const contents = this.tab.view.webContents;
    if (contents.isDestroyed()) throw new Error('标签页已关闭，浏览器调试通道不可用。');
    return contents.debugger;
  }

  ensureAttached(): void {
    const client = this.client();
    if (client.isAttached()) return;
    try {
      client.attach('1.3');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('already attached')) {
        throw new Error(`浏览器调试通道附加失败：${message}`);
      }
    }
    void client.sendCommand('Accessibility.enable').catch(() => undefined);
  }

  async send<T extends CdpResponse = CdpResponse>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = CDP_COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    this.ensureAttached();
    const client = this.client();
    try {
      return await withCdpTimeout(method, timeoutMs, () => client.sendCommand(method, params) as Promise<T>);
    } catch (err) {
      if (err instanceof CdpTimeoutError) this.recoverAfterTimeout(method);
      throw err;
    }
  }

  detach(): void {
    try {
      const contents = this.tab.view.webContents;
      if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
    } catch {
      // webContents 已销毁时 debugger 随之失效
    }
  }

  /** 重连使所有 backendNodeId 的有效性不可判定，generation++ 让全部旧 ref 失效 */
  private recoverAfterTimeout(timedOutMethod: string): void {
    try {
      const contents = this.tab.view.webContents;
      if (contents.isDestroyed()) return;
      const client = contents.debugger;
      if (client.isAttached()) client.detach();
      client.attach('1.3');
      void client.sendCommand('Accessibility.enable').catch(() => undefined);
      this.tab.generation += 1;
      console.warn(
        `[embedded-cdp] CDP ${timedOutMethod} 超时，已重连调试通道并使旧元素引用失效（generation=${this.tab.generation}）`,
      );
    } catch (err) {
      console.warn(`[embedded-cdp] CDP ${timedOutMethod} 超时后重连调试通道失败:`, err);
    }
  }
}

const sessions = new Map<string, EmbeddedCdpSession>();

export function getCdpSession(tab: EmbeddedTabRecord): EmbeddedCdpSession {
  const existing = sessions.get(tab.tabId);
  if (existing) return existing;
  const created = new EmbeddedCdpSession(tab);
  sessions.set(tab.tabId, created);
  const contents = tab.view.webContents;
  if (!contents.isDestroyed()) {
    contents.once('destroyed', () => {
      sessions.delete(tab.tabId);
    });
  }
  return created;
}

export function disposeCdpSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  session.detach();
}
