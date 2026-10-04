/**
 * 扩展通道会话独占（纯逻辑，无 IO，便于冒烟）
 *
 * 同一时刻仅一个 conversation 持有 dogear__extension__* 通道；持有者每次调用续期，
 * 空闲超过 IDLE_RELEASE_MS 自动释放防止误锁死。断连清零由 browser-gateway 接线。
 */

export const IDLE_RELEASE_MS = 10 * 60 * 1000;

export type AcquireResult = { ok: true } | { ok: false; busy: true; idleMs: number };

let currentOwner: string | null = null;
let lastAcquiredAt = 0;

export function acquireChannel(conversationId: string, now: number): AcquireResult {
  if (currentOwner === conversationId) {
    lastAcquiredAt = now;
    return { ok: true };
  }
  if (currentOwner !== null && now - lastAcquiredAt < IDLE_RELEASE_MS) {
    return { ok: false, busy: true, idleMs: now - lastAcquiredAt };
  }
  currentOwner = conversationId;
  lastAcquiredAt = now;
  return { ok: true };
}

export function getChannelOwner(): string | null {
  return currentOwner;
}

export function releaseChannel(conversationId: string): void {
  if (currentOwner !== conversationId) return;
  currentOwner = null;
  lastAcquiredAt = 0;
}

export function resetChannel(): void {
  currentOwner = null;
  lastAcquiredAt = 0;
}
