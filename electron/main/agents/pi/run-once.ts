import { Agent, type AgentEvent, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, ImageContent, Model, TextContent } from '@earendil-works/pi-ai';
import type { ModelProfile } from '../../services/settings-types.js';
import { type ToolDef, toPiTools } from './tool-adapter.js';
import { buildPiModels } from './provider.js';

/** 单次 runOnce 的 LLM 用量累加（口径对齐 usage-extractor 的 accumulatePiUsage：每条 AssistantMessage.usage 逐次累加） */
export interface RunOnceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

function extractRunOutcome(messages: Extract<AgentEvent, { type: 'agent_end' }>['messages']): {
  lastText?: string;
  usage?: RunOnceUsage;
} {
  let lastText: string | undefined;
  let usage: RunOnceUsage | undefined;
  for (const msg of messages) {
    if ((msg as AssistantMessage).role !== 'assistant') continue;
    const assistant = msg as AssistantMessage;
    const text = assistant.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) lastText = text;
    const u = assistant.usage;
    if (u) {
      usage = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
      usage.inputTokens += u.input ?? 0;
      usage.outputTokens += u.output ?? 0;
      usage.cacheReadInputTokens += u.cacheRead ?? 0;
      usage.cacheCreationInputTokens += u.cacheWrite ?? 0;
    }
  }
  return { lastText, usage };
}

/** 续跑兜底：某些模型在多步工具链中途会输出「宣布下一步」的纯文本就结束回合（无工具调用），
 * agent 循环视为任务完成。调用方用 revive 在「未完成但轮次未尽」时自动续跑。 */
export interface ReviveOptions {
  /** prompt 结束后调用，返回 true 表示任务未完成需要续跑 */
  shouldContinue: () => boolean;
  /** 续跑注入的提示词（可用函数按当前进度生成） */
  continuePrompt: string | (() => string);
  /** 最多续跑次数，默认 3 */
  maxRevives?: number;
}

/**
 * 对 pi Agent 发起一次性提炼任务，带轮次上限与外部取消支持。
 * 不抛出——失败以 { ok: false } 形式返回。
 */
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  images?: ImageContent[];
  tools: ToolDef[];
  model: Model<Api>;
  profile: ModelProfile;
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
  maxTurns?: number;
  revive?: ReviveOptions;
  onLog?: (msg: string) => void;
}): Promise<
    { ok: true; lastText?: string; usage?: RunOnceUsage }
    | { ok: false; error: string; cancelled?: boolean }
  > {
  const { systemPrompt = '', prompt, images, tools, model, profile, thinkingLevel = 'off', signal, maxTurns = 30, onLog } = opts;

  const piModels = buildPiModels(profile);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: toPiTools(tools),
      thinkingLevel,
    },
    streamFn: (m, ctx, streamOpts) =>
      piModels.streamSimple(m, ctx, { ...streamOpts, timeoutMs: profile.apiTimeoutMs }),
  });

  let turnCount = 0;
  let abortedByLimit = false;
  let cancelled = false;
  let outcome: { lastText?: string; usage?: RunOnceUsage } = {};

  agent.subscribe((e) => {
    if (e.type === 'turn_start') {
      if (++turnCount > maxTurns) {
        abortedByLimit = true;
        agent.abort();
      }
    } else if (e.type === 'tool_execution_start') {
      onLog?.(`[tool] ${e.toolName}`);
    } else if (e.type === 'tool_execution_end' && e.isError) {
      const raw = typeof e.result?.content?.[0]?.text === 'string'
        ? e.result.content[0].text
        : String(e.result ?? '');
      onLog?.(`[tool-error] ${e.toolName}: ${raw.slice(0, 300)}`);
    } else if (e.type === 'agent_end') {
      onLog?.(`[done] turns=${turnCount}`);
      outcome = extractRunOutcome(e.messages);
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
    await agent.prompt(prompt, images);
    let revives = 0;
    while (
      !cancelled && !abortedByLimit && opts.revive
      && revives < (opts.revive.maxRevives ?? 3)
      && !signal?.aborted
      && opts.revive.shouldContinue()
    ) {
      revives++;
      onLog?.(`[revive] 收笔未完成，第 ${revives} 次续跑`);
      const msg = typeof opts.revive.continuePrompt === 'function'
        ? opts.revive.continuePrompt()
        : opts.revive.continuePrompt;
      await agent.prompt(msg);
    }
  } catch (e) {
    if (cancelled) return { ok: false, error: '已取消', cancelled: true };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (cancelled) return { ok: false, error: '已取消', cancelled: true };
  if (abortedByLimit) return { ok: false, error: `超过最大轮次 ${maxTurns}` };
  return { ok: true, ...outcome };
}
