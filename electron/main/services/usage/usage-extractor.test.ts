import { test, expect } from 'bun:test';
import { extractUsageEntry, MODEL_CONTEXT_WINDOWS } from './usage-extractor.ts';

test('从 result 消息提取 usage 三件套与时序', () => {
  const result = {
    type: 'result', uuid: 'r1', subtype: 'success', is_error: false,
    duration_ms: 1000, duration_api_ms: 800, num_turns: 2, total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 10 },
    modelUsage: { 'claude-opus-4-7': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 900, cacheCreationInputTokens: 10, webSearchRequests: 0, costUSD: 0.01, contextWindow: 200000, maxOutputTokens: 64000 } },
  } as any;
  const turnMsgs = [
    { type: 'tool_use', toolName: 'Read' }, { type: 'tool_use', toolName: 'Read' }, { type: 'tool_use', toolName: 'Grep' },
  ] as any;
  const entry = extractUsageEntry(result, turnMsgs, 1);
  expect(entry.usage.inputTokens).toBe(100);
  expect(entry.usage.cacheReadInputTokens).toBe(900);
  expect(entry.turnIndex).toBe(1);
  expect(entry.toolCalls).toEqual([{ name: 'Read', count: 2 }, { name: 'Grep', count: 1 }]);
  expect(entry.totalCostUsd).toBe(0.01);
});

test('GLM 缺 modelUsage 时用 usage 合成一份', () => {
  const result = {
    type: 'result', uuid: 'r2', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as any;
  const entry = extractUsageEntry(result, [], 1, 'glm-4-plus');
  expect(Object.keys(entry.modelUsage).length).toBe(1);
  expect(entry.modelUsage['glm-4-plus'].inputTokens).toBe(10);
});

test('MODEL_CONTEXT_WINDOWS 含常见模型兜底', () => {
  expect(MODEL_CONTEXT_WINDOWS['claude-opus-4-7']).toBeGreaterThan(0);
});

test('Agent 工具调用单独拆到 subagentCalls，不混进 toolCalls', () => {
  const result = { type: 'result', uuid: 'r3', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as any;
  const turnMsgs = [
    { type: 'tool_use', toolName: 'Agent' },
    { type: 'tool_result', subAgentId: 'a1', subAgentTokens: 500, subAgentToolUseCount: 3, subAgentDurationMs: 200 },
  ] as any;
  const entry = extractUsageEntry(result, turnMsgs, 1);
  expect(entry.toolCalls.find(t => t.name === 'Agent')).toBeUndefined();
  expect(entry.subagentCalls?.[0].totalTokens).toBe(500);
});
