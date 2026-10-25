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
 * - durationApiMs = Σ AssistantMessage.durationMs（各次 LLM call 串行不重叠）；
 *   durationMs = 首次请求发出 → 末次响应结束的差值（含中间工具执行，不含队列等待）
 * - reasoning / serviceTier / speed / serverToolUse：pi 不暴露，丢弃
 *
 * 累加语义：inputTokens 等字段是"每轮 LLM call 的全部输入 token"——会重复计算
 * （第二轮 input 包含第一轮的内容）。这与 SDK 侧 result.usage.input_tokens 的累加
 * 口径一致，所以总和可对比。
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai';
import type { ContextSnapshot, ConversationUsageEntry, ToolCallRecord, ToolActivity } from '../../types.js';
import type { ExtendedSessionMessage } from '../task-types.js';
import { lookupContextWindow } from '../pi/model-catalog.js';

const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

const CJK_CHAR = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;

export interface ContextCategoryDraft {
  name: string;
  tokens: number;
}

/** 上下文构成估算：CJK 字符 ×1 + 其他字符 ×0.25，向上取整 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK_CHAR.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other * 0.25);
}

/** CTX 快照的上下文占用口径：请求输入侧 total = input + cacheRead + cacheWrite（不含输出） */
export function contextTotalTokens(usage: Usage): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

/** 未校准构成按真实 totalTokens 等比缩放，round 残差并入最大桶，保证合计恒等于 totalTokens；Σ=0 时不除零返回空 */
function calibrateCategories(composition: ContextCategoryDraft[] | undefined, totalTokens: number): Array<{ name: string; tokens: number }> {
  if (!composition || composition.length === 0) return [];
  const sum = composition.reduce((acc, c) => acc + c.tokens, 0);
  if (sum <= 0 || totalTokens <= 0) return [];
  const categories = composition.map((c) => ({ name: c.name, tokens: Math.round((c.tokens / sum) * totalTokens) }));
  const drift = totalTokens - categories.reduce((acc, c) => acc + c.tokens, 0);
  if (drift !== 0) {
    let maxIdx = 0;
    for (let i = 1; i < categories.length; i++) {
      if (categories[i].tokens > categories[maxIdx].tokens) maxIdx = i;
    }
    categories[maxIdx].tokens += drift;
  }
  return categories;
}

export interface PiUsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite1hTokens: number;
  totalCostUsd: number;
  messageCount: number;
  /** Σ AssistantMessage.durationMs（各次 LLM call 串行不重叠） */
  durationApiMs: number;
  /** 首次请求发出时点 / 末次响应结束时点（timestamp + durationMs），差值即本轮 API+工具全程 */
  firstRequestAt?: number;
  lastResponseEndAt?: number;
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
    durationApiMs: 0,
    modelUsageBreakdown: new Map(),
  };
}

/** 从单条 assistant message 创建当前上下文用量快照。composition 传未校准构成原值，内部按 totalTokens 校准后写 categories。 */
export function extractPiContextSnapshot(
  message: AssistantMessage,
  turnIndex: number,
  resolveWindow?: (modelId: string) => number,
  composition?: ContextCategoryDraft[],
): ContextSnapshot | null {
  // 失败消息（如 quota 错误的空 assistant）不产快照，避免落盘 total=0 pct=0 的假 CTX
  if (message.errorMessage) return null;
  const usage = message.usage;
  if (!usage) return null;

  const model = message.responseModel || message.model;
  const totalTokens = contextTotalTokens(usage);
  const resolve = resolveWindow ?? ((id: string) => lookupContextWindow(id) ?? 0);
  const maxTokens = resolve(model);

  return {
    turnIndex,
    timestamp: Date.now(),
    totalTokens,
    maxTokens,
    percentage: maxTokens > 0 ? totalTokens / maxTokens * 100 : 0,
    model,
    categories: calibrateCategories(composition, totalTokens),
  };
}

/** 把 buildContext 的 AgentMessage[] 按 消息·用户 / 消息·助手 / 消息·工具结果 分桶估算；
 *  其余 role（bashExecution/custom/branchSummary/compactionSummary）经 convertToLlm 都转成 user，并入用户桶 */
export function estimateMessageBuckets(messages: AgentMessage[]): ContextCategoryDraft[] {
  let userText = '';
  let assistantText = '';
  let toolResultText = '';
  for (const msg of messages) {
    switch (msg.role) {
      case 'user':
        userText += blocksText((msg as { content?: unknown }).content);
        break;
      case 'assistant':
        assistantText += assistantMessageText(msg);
        break;
      case 'toolResult':
        toolResultText += blocksText((msg as { content?: unknown }).content);
        break;
      default:
        userText += customMessageText(msg);
        break;
    }
  }
  return [
    { name: '消息·用户', tokens: estimateTokens(userText) },
    { name: '消息·助手', tokens: estimateTokens(assistantText) },
    { name: '消息·工具结果', tokens: estimateTokens(toolResultText) },
  ];
}

function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => (block as { type?: string } | null)?.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('');
}

function assistantMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    const type = (block as { type?: string } | null)?.type;
    if (type === 'text') parts.push((block as { text: string }).text);
    else if (type === 'thinking') parts.push((block as { thinking: string }).thinking);
    else if (type === 'toolCall') {
      const call = block as { name: string; arguments?: Record<string, unknown> };
      parts.push(`${call.name}${JSON.stringify(call.arguments ?? {})}`);
    }
  }
  return parts.join('');
}

function customMessageText(message: AgentMessage): string {
  const m = message as {
    excludeFromContext?: boolean;
    command?: string;
    output?: string;
    content?: unknown;
    summary?: string;
  };
  if (m.excludeFromContext) return '';
  if (typeof m.command === 'string') return m.command + (m.output ?? '');
  if (typeof m.summary === 'string') return m.summary;
  return blocksText(m.content);
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

  const callDuration = Number.isFinite(message.durationMs) ? message.durationMs! : 0;
  accum.durationApiMs += callDuration;
  if (Number.isFinite(message.timestamp)) {
    if (accum.firstRequestAt === undefined || message.timestamp < accum.firstRequestAt) {
      accum.firstRequestAt = message.timestamp;
    }
    const end = message.timestamp + callDuration;
    if (accum.lastResponseEndAt === undefined || end > accum.lastResponseEndAt) {
      accum.lastResponseEndAt = end;
    }
  }

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
 * lastContextTokens：本轮最后一条 CTX 快照的 totalTokens（请求时点真实上下文占用），
 * 供 applyUsageSummary 写入 conversations.json 的 lastContextSize；无值时不附字段。
 */
export function extractPiUsageEntry(
  accum: PiUsageAccumulator,
  turnMessages: ExtendedSessionMessage[],
  turnIndex: number,
  fallbackModelId?: string,
  resolveWindow?: (modelId: string) => number,
  lastContextTokens?: number,
): ConversationUsageEntry {
  const resolve = resolveWindow ?? ((id: string) => lookupContextWindow(id) ?? 0);
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
      contextWindow: resolve(modelId),
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
      contextWindow: resolve(model),
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

  const entry: ConversationUsageEntry = {
    uuid: '',
    turnIndex,
    timestamp: Date.now(),
    durationMs:
      accum.firstRequestAt !== undefined && accum.lastResponseEndAt !== undefined
        ? Math.max(0, accum.lastResponseEndAt - accum.firstRequestAt)
        : 0,
    durationApiMs: accum.durationApiMs,
    numTurns: accum.messageCount,
    terminalReason,
    stopReason,
    isError,
    totalCostUsd: accum.totalCostUsd,
    usage,
    modelUsage,
    toolActivity,
  };
  if (lastContextTokens !== undefined) entry.lastContextTokens = lastContextTokens;
  return entry;
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
