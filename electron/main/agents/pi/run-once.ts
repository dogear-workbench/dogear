import { Agent } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { ModelProfile } from '../../services/settings-types.js';
import { type ToolDef, toPiTools } from './tool-adapter.js';
import { buildPiModels } from './provider.js';

/**
 * 对 pi Agent 发起一次性提炼任务，带轮次上限与外部取消支持。
 * 不抛出——失败以 { ok: false } 形式返回。
 */
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  tools: ToolDef[];
  model: Model<'anthropic-messages'>;
  profile: ModelProfile;
  signal?: AbortSignal;
  maxTurns?: number;
  onLog?: (msg: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  const { systemPrompt = '', prompt, tools, model, profile, signal, maxTurns = 30, onLog } = opts;

  const piModels = buildPiModels(profile);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: toPiTools(tools),
    },
    streamFn: (m, ctx, streamOpts) =>
      piModels.streamSimple(m, ctx, { ...streamOpts, timeoutMs: profile.apiTimeoutMs }),
  });

  let turnCount = 0;
  let abortedByLimit = false;
  let cancelled = false;

  agent.subscribe((e) => {
    if (e.type === 'turn_start') {
      if (++turnCount > maxTurns) {
        abortedByLimit = true;
        agent.abort();
      }
    } else if (e.type === 'tool_execution_start') {
      onLog?.(`[tool] ${e.toolName}`);
    } else if (e.type === 'agent_end') {
      onLog?.(`[done] turns=${turnCount}`);
    }
  });

  if (signal?.aborted) {
    return { ok: false, error: '已取消', cancelled: true };
  }
  if (signal) {
    signal.addEventListener('abort', () => {
      cancelled = true;
      agent.abort();
    }, { once: true });
  }

  try {
    await agent.prompt(prompt);
  } catch (e) {
    if (cancelled) return { ok: false, error: '已取消', cancelled: true };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (cancelled) return { ok: false, error: '已取消', cancelled: true };
  if (abortedByLimit) return { ok: false, error: `超过最大轮次 ${maxTurns}` };
  return { ok: true };
}
