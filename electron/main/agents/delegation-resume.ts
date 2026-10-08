/**
 * 子会话重调决策纯逻辑（重调层）
 *
 * 错误分类后的「要不要复活 / 要不要换供应商」决策与继续提示词构造。
 * 编排（重新 attach、计时器重挂、消息发送）在 delegation-bridge.ts 的 resumeChild。
 * quota 降级来源是全局 failover 链：调用方传入 model-failover.ts findNextFailover 的结果，
 * subAgent.profiles 回归纯功能配置，不再承担降级链职责。
 */

import type { FailoverEntry, ModelSelection } from '../services/settings-types.js';
import { getDelegationMaxRetry } from './delegation-terminal.js';

export interface ResumeDecision {
  resume: boolean;
  modelOverride?: ModelSelection | null;
}

/**
 * transient：consecutiveFails 未耗尽即复活（不换模型）。
 * quota：fallback（findNextFailover 结果）缺失、已试过、或连续失败数超上限都视为链耗尽。
 */
export function decideResumeOnError(
  errorClass: string | undefined,
  consecutiveFails: number,
  modelTried: string[],
  fallback: FailoverEntry | null,
): ResumeDecision {
  if (errorClass === 'cancelled' || !errorClass) return { resume: false };
  if (errorClass === 'transient') {
    return consecutiveFails < getDelegationMaxRetry() ? { resume: true } : { resume: false };
  }
  if (errorClass !== 'quota') return { resume: false };
  if (consecutiveFails >= getDelegationMaxRetry() + 1) return { resume: false };
  if (!fallback) return { resume: false };
  if (modelTried.includes(`${fallback.profileId}:${fallback.tier}`)) return { resume: false };
  return { resume: true, modelOverride: fallback };
}

export function buildResumePrompt(reason: string, outputPath: string): string {
  const fileHint = outputPath
    ? `和共享区已有的产出（若共享区文件 ${outputPath} 已有部分内容，先读取确认进度）`
    : '';
  return `你刚才因${reason}中断。请检查已完成的部分${fileHint}，从中断处继续完成任务，不要从头重做。`;
}
