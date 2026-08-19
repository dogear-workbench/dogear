import type { PiSessionTurnResult } from './pi-session/pi-session.js';
import type { ChildTerminalReason } from '../types.js';

export interface ChildCompletionClassification {
  terminalReason?: ChildTerminalReason;
  lastError?: string;
}

/** complete 事件分类：success 分支的 terminalReason 取决于调用方交付事实（delivered） */
export function classifyChildCompletion(result: PiSessionTurnResult, delivered: boolean): ChildCompletionClassification {
  if (result.subtype === 'failed') {
    return {
      terminalReason: 'failed',
      lastError: result.error?.message || '会话运行失败',
    };
  }
  if (result.subtype === 'cancelled') {
    return {
      terminalReason: 'cancelled',
      lastError: result.error?.message || '会话已取消',
    };
  }
  return delivered ? {} : {
    terminalReason: 'no_delivery',
    lastError: '会话结束但未交付',
  };
}
