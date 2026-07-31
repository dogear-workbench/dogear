/**
 * pi 会话 usage 提取（Step 6）
 *
 * pi 的 usage 数据嵌在每条 AssistantMessage.usage 里（每次 LLM call 一份），
 * 没有 SDK 那种"整 run 累计"的 result.usage。本模块负责：
 * 1. 在每条 AssistantMessage 到达时累加到 PiUsageAccumulator
 * 2. 在 agent_end 时把累加器转成 ConversationUsageEntry，让现有 usage 徽章零改动复用
 *
 * 字段映射（pi.Usage → ConversationUsageEntry.usage）：
 * - input/output 直接对应 inputTokens/outputTokens
 * - cacheRead → cacheReadInputTokens
 * - cacheWrite → cacheCreationInputTokens（pi 不区分 5m/1h，cacheWrite1h 是 1h 子集）
 * - cacheCreation.ephemeral1h = cacheWrite1h；ephemeral5m = cacheWrite - cacheWrite1h
 * - cost.total → totalCostUsd
 * - reasoning / serviceTier / speed / serverToolUse：pi 不暴露，丢弃
 *
 * 累加语义：inputTokens 等字段是"每轮 LLM call 的全部输入 token"——会重复计算
 * （第二轮 input 包含第一轮的内容）。这与 SDK 侧 result.usage.input_tokens 的累加
 * 口径一致，所以总和可对比。
 */

import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { ConversationUsageEntry, ToolCallRecord, ToolActivity } from '../../types.js';
import type { ExtendedSessionMessage } from '../task-types.js';
import { MODEL_CONTEXT_WINDOWS } from '../../services/usage/usage-extractor.js';

const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

export interface PiUsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
  totalCostUsd: number;
  messageCount: number;
  lastModelId?: string;
  lastResponseId?: string;
  lastStopReason?: string;
  lastErrorMessage?: string;
  modelUsageBreakdown: Map<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
  }>;
}

export function createPiUsageAccumulator(): PiUsageAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    totalCostUsd: 0,
    messageCount: 0,
    modelUsageBreakdown: new Map(),
  };
}

/** 把单条 AssistantMessage.usage 累加到累加器 */
export function accumulatePiUsage(accum: PiUsageAccumulator, message: AssistantMessage): void {
  const u: Usage | undefined = message.usage;
  const input = u?.input ?? 0;
  const output = u?.output ?? 0;
  const cacheRead = u?.cacheRead ?? 0;
  const cacheWrite = u?.cacheWrite ?? 0;
  const cacheWrite1h = u?.cacheWrite1h ?? 0;
  const costTotal = u?.cost?.total ?? 0;

  accum.inputTokens += input;
  accum.outputTokens += output;
  accum.cacheReadTokens += cacheRead;
  accum.cacheWriteTokens += cacheWrite;
  accum.cacheWrite1hTokens += cacheWrite1h;
  accum.totalCostUsd += costTotal;
  accum.messageCount += 1;

  const modelId = message.responseModel || message.model;
  accum.lastModelId = modelId;
  if (message.responseId) accum.lastResponseId = message.responseId;
  accum.lastStopReason = message.stopReason;
  if (message.errorMessage) accum.lastErrorMessage = message.errorMessage;

  const bucket = accum.modelUsageBreakdown.get(modelId) ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  };
  bucket.inputTokens += input;
  bucket.outputTokens += output;
  bucket.cacheReadInputTokens += cacheRead;
  bucket.cacheCreationInputTokens += cacheWrite;
  bucket.costUSD += costTotal;
  accum.modelUsageBreakdown.set(modelId, bucket);
}

/**
 * 把本轮累加器 + 本轮 emit 过的 ExtendedSessionMessage 列表转成 ConversationUsageEntry。
 * 与 SDK 侧 extractUsageEntry 输出结构完全一致，下游 usage-service / 前端徽章零改动。
 */
export function extractPiUsageEntry(
  accum: PiUsageAccumulator,
  turnMessages: ExtendedSessionMessage[],
  turnIndex: number,
  fallbackModelId?: string,
): ConversationUsageEntry {
  const usage: ConversationUsageEntry['usage'] = {
    inputTokens: accum.inputTokens,
    outputTokens: accum.outputTokens,
    cacheCreationInputTokens: accum.cacheWriteTokens,
    cacheReadInputTokens: accum.cacheReadTokens,
  };
  if (accum.cacheWriteTokens > 0 || accum.cacheWrite1hTokens > 0) {
    usage.cacheCreation = {
      ephemeral1hInputTokens: accum.cacheWrite1hTokens,
      ephemeral5mInputTokens: Math.max(0, accum.cacheWriteTokens - accum.cacheWrite1hTokens),
    };
  }

  const modelUsage: ConversationUsageEntry['modelUsage'] = {};
  for (const [modelId, bucket] of accum.modelUsageBreakdown) {
    modelUsage[modelId] = {
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      cacheReadInputTokens: bucket.cacheReadInputTokens,
      cacheCreationInputTokens: bucket.cacheCreationInputTokens,
      webSearchRequests: 0,
      costUSD: bucket.costUSD,
      contextWindow: MODEL_CONTEXT_WINDOWS[modelId] ?? 0,
      maxOutputTokens: 0,
    };
  }
  if (Object.keys(modelUsage).length === 0) {
    const model = fallbackModelId ?? 'unknown';
    modelUsage[model] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0,
      contextWindow: MODEL_CONTEXT_WINDOWS[model] ?? 0,
      maxOutputTokens: 0,
    };
  }

  const toolActivity = buildToolActivity(turnMessages);

  const stopReason = accum.lastStopReason ?? null;
  let terminalReason: string | undefined;
  let isError = false;
  if (accum.lastErrorMessage) {
    isError = true;
    terminalReason = 'error';
  } else if (stopReason === 'aborted') {
    terminalReason = 'aborted';
  } else if (stopReason === 'length') {
    terminalReason = 'max_turns';
  } else if (stopReason === 'stop' || stopReason === 'toolUse') {
    terminalReason = 'completed';
  }

  return {
    uuid: '',
    turnIndex,
    timestamp: Date.now(),
    durationMs: 0,
    durationApiMs: 0,
    numTurns: accum.messageCount,
    terminalReason,
    stopReason,
    isError,
    totalCostUsd: accum.totalCostUsd,
    usage,
    modelUsage,
    toolActivity,
  };
}

/** 与 SDK 侧 extractUsageEntry 的 toolActivity 聚合口径一致：按工具名计数，Read 工具收集 file_path（去重保序） */
function buildToolActivity(turnMessages: ExtendedSessionMessage[]): ToolActivity | undefined {
  const toolMap = new Map<string, { count: number; files?: string[]; fileSet?: Set<string> }>();
  for (const msg of turnMessages) {
    if (msg.type !== 'tool_use' || !msg.toolName) continue;
    if (SUBAGENT_TOOL_NAMES.has(msg.toolName)) continue;
    let rec = toolMap.get(msg.toolName);
    if (!rec) {
      rec = { count: 0 };
      if (msg.toolName === 'Read') {
        rec.files = [];
        rec.fileSet = new Set();
      }
      toolMap.set(msg.toolName, rec);
    }
    rec.count += 1;
    if (msg.toolName === 'Read' && rec.fileSet) {
      const fp = (msg.toolInput as { file_path?: unknown } | undefined)?.file_path;
      if (typeof fp === 'string' && fp && !rec.fileSet.has(fp)) {
        rec.fileSet.add(fp);
        rec.files!.push(fp);
      }
    }
  }
  const calls: ToolCallRecord[] = Array.from(toolMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, rec]) => {
      const out: ToolCallRecord = { name, count: rec.count };
      if (rec.files && rec.files.length > 0) out.files = rec.files;
      return out;
    });
  let totalCalls = 0;
  for (const c of calls) totalCalls += c.count;
  return calls.length > 0 ? { calls, totalCalls } : undefined;
}
