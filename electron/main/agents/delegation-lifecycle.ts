import type { PiSessionTurnResult } from './pi-session/pi-session.js';
import type { ChildStatus } from '../types.js';

export interface ChildCompletionClassification {
  status: Extract<ChildStatus, 'failed' | 'cancelled' | 'no_delivery'>;
  errorMessage: string;
}

export function classifyChildCompletion(result: PiSessionTurnResult): ChildCompletionClassification {
  if (result.subtype === 'failed') {
    return {
      status: 'failed',
      errorMessage: result.error?.message || '会话运行失败',
    };
  }
  if (result.subtype === 'cancelled') {
    return {
      status: 'cancelled',
      errorMessage: result.error?.message || '会话已取消',
    };
  }
  return {
    status: 'no_delivery',
    errorMessage: '会话结束但未交付',
  };
}
