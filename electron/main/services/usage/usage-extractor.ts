import type { ConversationUsageEntry, ToolActivity, ToolCallRecord } from '../../types.js';

/** 子代理工具名集合，与 SDK Task 工具命名保持一致但不直接导入以避免耦合 */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

/** 已知模型的 context window 大小（保守取值） */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-7': 200000,
  'claude-opus-4-6': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-haiku-4-5': 200000,
  'glm-4-plus': 128000,
  'glm-4.6': 200000,
};

/** 零值 usage 形状，用于子代理记录占位 */
function zeroUsage(): ConversationUsageEntry['usage'] {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

/**
 * 从 SDK result 消息 + 本轮工具调用快照中提取 ConversationUsageEntry。
 * 纯函数，无 IO。
 */
export function extractUsageEntry(
  result: any,
  turnMessages: any[],
  turnIndex: number,
  fallbackModel?: string,
): ConversationUsageEntry {
  const u = result.usage ?? {};

  // ── usage 字段映射（snake_case → camelCase）──
  const usage: ConversationUsageEntry['usage'] = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };

  if (u.cache_creation != null) {
    usage.cacheCreation = {
      ephemeral5mInputTokens: u.cache_creation.ephemeral_5m_input_tokens ?? 0,
      ephemeral1hInputTokens: u.cache_creation.ephemeral_1h_input_tokens ?? 0,
    };
  }

  if (u.service_tier != null) {
    usage.serviceTier = u.service_tier;
  }

  if (u.speed != null) {
    usage.speed = u.speed;
  }

  if (u.server_tool_use != null) {
    usage.serverToolUse = {
      webSearchRequests: u.server_tool_use.web_search_requests ?? 0,
      webFetchRequests: u.server_tool_use.web_fetch_requests ?? 0,
    };
  }

  // ── modelUsage：有就透传，没有就用 fallbackModel 合成 ──
  let modelUsage: ConversationUsageEntry['modelUsage'];
  if (result.modelUsage && Object.keys(result.modelUsage).length > 0) {
    modelUsage = result.modelUsage;
  } else {
    const model = fallbackModel ?? 'unknown';
    modelUsage = {
      [model]: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
        webSearchRequests: 0,
        costUSD: result.total_cost_usd ?? 0,
        contextWindow: MODEL_CONTEXT_WINDOWS[model] ?? 0,
        maxOutputTokens: 0,
      },
    };
  }

  // ── toolActivity：按名称计数，排除子代理工具；Read 工具收集 file_path（去重保序）──
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
      const fp = msg.toolInput?.file_path ?? msg.input?.file_path;
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
  const toolActivity: ToolActivity | undefined = calls.length > 0
    ? { calls, totalCalls }
    : undefined;

  // ── subagentCalls：从 tool_result 中提取 subAgentId 的记录 ──
  const subagentMessages = turnMessages.filter((msg) => msg.subAgentId);
  const subagentCalls = subagentMessages.length > 0
    ? subagentMessages.map((msg) => ({
        agentId: msg.subAgentId as string,
        totalTokens: msg.subAgentTokens ?? 0,
        totalToolUseCount: msg.subAgentToolUseCount ?? 0,
        totalDurationMs: msg.subAgentDurationMs ?? 0,
        usage: zeroUsage(),
      }))
    : undefined;

  return {
    uuid: result.uuid ?? '',
    turnIndex,
    parentUuid: result.parent_tool_use_id ?? undefined,
    timestamp: Date.now(),
    durationMs: result.duration_ms ?? 0,
    durationApiMs: result.duration_api_ms ?? 0,
    ttftMs: result.ttft_ms,
    numTurns: result.num_turns ?? 0,
    terminalReason: result.terminal_reason,
    stopReason: result.stop_reason ?? null,
    isError: !!result.is_error,
    apiErrorStatus: result.api_error_status,
    totalCostUsd: result.total_cost_usd ?? 0,
    usage,
    modelUsage,
    toolActivity,
    subagentCalls,
    permissionDenials: result.permission_denials,
  };
}
