/**
 * 子会话重调决策纯逻辑（重调层）
 *
 * 错误分类后的「要不要复活 / 要不要换供应商」决策与继续提示词构造。
 * 编排（重新 attach、计时器重挂、消息发送）在 delegation-bridge.ts 的 resumeChild。
 */

import type { ModelSelection, SubAgentProfile } from '../services/settings-types.js';
import { getDelegationMaxRetry } from './delegation-terminal.js';

export interface ResumeDecision {
  resume: boolean;
  modelOverride?: ModelSelection | null;
}

/** 按列表顺序找第一个「已启用且配置了异供应商模型」的 profile，返回其 modelSelection */
export function findFallbackModel(profiles: SubAgentProfile[], currentProfileId: string): ModelSelection | null {
  for (const p of profiles) {
    if (p.enabled === false) continue;
    if (!p.modelSelection) continue;
    if (p.modelSelection.profileId === currentProfileId) continue;
    return p.modelSelection;
  }
  return null;
}

/**
 * transient：retryCount 未耗尽即复活（不换模型）。
 * quota：只降级一次——fallback 缺失、已试过 fallback、或重试数超上限都视为耗尽。
 */
export function decideResumeOnError(
  errorClass: string | undefined,
  retryCount: number,
  modelTried: string[],
  fallback: ModelSelection | null,
): ResumeDecision {
  if (errorClass === 'cancelled' || !errorClass) return { resume: false };
  if (errorClass === 'transient') {
    return retryCount < getDelegationMaxRetry() ? { resume: true } : { resume: false };
  }
  if (errorClass !== 'quota') return { resume: false };
  if (retryCount >= getDelegationMaxRetry() + 1) return { resume: false };
  if (!fallback) return { resume: false };
  if (modelTried.includes(`${fallback.profileId}:${fallback.tier}`)) return { resume: false };
  return { resume: true, modelOverride: fallback };
}

export function buildResumePrompt(reason: string, outputPath: string): string {
  return `你刚才因${reason}中断。请检查已完成的部分和共享区已有的产出（若共享区文件 ${outputPath} 已有部分内容，先读取确认进度），从中断处继续完成任务，不要从头重做。`;
}
