/**
 * 子会话滑动 idle 计时（检测层）
 *
 * 供应商 hang 住（流不结束也不报错）时无任何 complete 事件，只能靠「N 分钟无流事件」判死。
 * 所有流事件（text_delta / thinking_delta / tool_execution_start / tool_execution_end）经
 * convertPiEvent 走 PiSession 的 'message' 事件，watch 内部 touch 重置计时即可。
 * 唯一空窗是单个长工具执行期间（无 delta），靠阈值 ≥10 分钟兜底。
 */

import { EventEmitter } from 'events';

export const IDLE_TIMEOUT_MS = 10 * 60_000;

let effectiveIdleTimeoutMs = IDLE_TIMEOUT_MS;

/** 测试注入用：把阈值临时调小以验证 idle 判定，生产路径不调用 */
export function setDelegationIdleTimeoutMs(ms: number): void {
  effectiveIdleTimeoutMs = ms;
}

export function getDelegationIdleTimeoutMs(): number {
  return effectiveIdleTimeoutMs;
}

export interface IdleWatch {
  touch(): void;
  dispose(): void;
}

export interface IdleWatchOptions {
  session: EventEmitter;
  /** 每次流事件回调（更新 lastActivityAt 等外部记账） */
  onActivity: () => void;
  /** idle 到期（连续无流事件）回调 */
  onIdle: () => void;
  timeoutMs?: number;
}

export function createIdleWatch(opts: IdleWatchOptions): IdleWatch {
  const { session, onActivity, onIdle } = opts;
  const timeoutMs = opts.timeoutMs ?? getDelegationIdleTimeoutMs();
  let timer: NodeJS.Timeout | undefined;

  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onIdle, timeoutMs);
  };
  const onMessage = () => {
    onActivity();
    arm();
  };

  session.on('message', onMessage);
  arm();

  return {
    touch: arm,
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      session.off('message', onMessage);
    },
  };
}
